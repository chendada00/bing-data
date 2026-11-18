#!/usr/bin/env node
'use strict'

/**
 * 为 bing-data 历史壁纸补充 AI 解读。
 *
 * 规则：
 * - 扫描 data/YYYY/MM.json 中所有壁纸记录；
 * - 日期倒序处理，开始/结束日期均包含；
 * - 默认跳过已有非空 aiStory.story 的记录；
 * - FORCE=true 时覆盖已有解读；
 * - 最多成功补充 MAX_ITEMS 条，最大值硬限制为 30；
 * - 每成功一条立即写回对应月度 JSON，便于中断后续跑；
 * - 使用独立的 TENCENT_MAAS_* 环境变量，不修改每日任务的接口配置。
 */

const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const DATA_ROOT = path.join(ROOT, 'data')
const DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1'
// DeepSeek V4.1 Flash 在 TokenHub 模型列表中属于通用对话模型；
// 该项目需要把图片传给模型，因此默认选择文档标注的视觉模型。
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-vision-exp'
const MAX_CONSECUTIVE_FAILURES = 5
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function validateDate(value, name) {
  if (!value) return ''
  const text = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${name} 必须使用 YYYY-MM-DD 格式`)
  }
  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${name} 不是有效日期：${text}`)
  }
  return text
}

function getConfig() {
  const startDate = validateDate(process.env.START_DATE || '', 'START_DATE')
  const endDate = validateDate(process.env.END_DATE || '', 'END_DATE')
  if (startDate && endDate && startDate > endDate) {
    throw new Error('START_DATE 不能晚于 END_DATE')
  }

  const maxItemsRaw = process.env.MAX_ITEMS || '30'
  if (!/^\d+$/.test(maxItemsRaw)) {
    throw new Error('MAX_ITEMS 必须是 1 到 30 之间的整数')
  }
  const maxItems = Number(maxItemsRaw)
  if (maxItems < 1 || maxItems > 30) {
    throw new Error('MAX_ITEMS 必须是 1 到 30 之间的整数')
  }

  const apiKey = String(process.env.TENCENT_MAAS_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('缺少 TENCENT_MAAS_API_KEY，请在 GitHub Actions Secrets 中配置')
  }

  return {
    startDate,
    endDate,
    force: parseBoolean(process.env.FORCE, false),
    maxItems,
    apiKey,
    baseURL: String(process.env.TENCENT_MAAS_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model: String(process.env.TENCENT_MAAS_MODEL || DEFAULT_MODEL).trim(),
    uhdRoot: path.resolve(process.env.UHD_ROOT || 'bing-uhd')
  }
}

function listMonthFiles() {
  if (!fs.existsSync(DATA_ROOT)) {
    throw new Error(`数据目录不存在：${DATA_ROOT}`)
  }

  const result = []
  const years = fs.readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map(entry => entry.name)
    .sort()

  for (const year of years) {
    const yearDir = path.join(DATA_ROOT, year)
    const months = fs.readdirSync(yearDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^\d{2}\.json$/.test(entry.name))
      .map(entry => entry.name)
      .sort()

    for (const monthFile of months) {
      result.push(path.join(yearDir, monthFile))
    }
  }

  return result
}

function readRecords(config) {
  const records = []
  const files = listMonthFiles()

  for (const file of files) {
    let monthData
    try {
      monthData = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`月度 JSON 解析失败，已停止以避免漏处理数据：${path.relative(ROOT, file)}；${error.message}`)
    }

    if (!monthData || !Array.isArray(monthData.items)) {
      log(`跳过不含 items 数组的文件：${path.relative(ROOT, file)}`)
      continue
    }

    for (const item of monthData.items) {
      const date = typeof item?.date === 'string' ? item.date : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (config.startDate && date < config.startDate) continue
      if (config.endDate && date > config.endDate) continue

      records.push({ file, monthData, item, date })
    }
  }

  records.sort((a, b) => b.date.localeCompare(a.date))
  return { records, fileCount: files.length }
}

function hasExistingStory(item) {
  return Boolean(
    item &&
    item.aiStory &&
    typeof item.aiStory === 'object' &&
    typeof item.aiStory.story === 'string' &&
    item.aiStory.story.trim().length > 0
  )
}

function getLocalUhdPath(config, date) {
  const year = date.slice(0, 4)
  const month = date.slice(5, 7)
  return path.join(config.uhdRoot, 'images', year, month, `${date}.jpg`)
}

async function validateImageBuffer(buffer, source) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10 * 1024) {
    throw new Error(`图片内容为空或过小：${source}`)
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 25MB 限制：${source}`)
  }

  const Jimp = require('jimp')
  const image = await Jimp.read(buffer)
  if (!image.bitmap.width || !image.bitmap.height) {
    throw new Error(`无法识别图片尺寸：${source}`)
  }
  return buffer
}

async function downloadImage(url) {
  if (!url) throw new Error('图片 URL 为空')
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`图片 URL 无效：${url}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`只允许通过 HTTPS 下载图片：${url}`)
  }

  const response = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BingWallpaperAIBackfill/1.0)',
      'Accept': 'image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(60000)
  })

  if (!response.ok) {
    throw new Error(`下载图片失败，HTTP ${response.status}：${url}`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 25MB 限制：${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return validateImageBuffer(buffer, url)
}

async function loadWallpaperImage(config, item, date) {
  const localPath = getLocalUhdPath(config, date)
  if (fs.existsSync(localPath)) {
    try {
      const buffer = fs.readFileSync(localPath)
      await validateImageBuffer(buffer, localPath)
      log(`使用本地 UHD 图片：${path.relative(ROOT, localPath)}`)
      return buffer
    } catch (error) {
      log(`本地 UHD 图片不可用，尝试远程地址：${error.message}`)
    }
  }

  // 先尝试 Bing 官方 UHD，再尝试项目自己的 UHD CDN。
  const urls = [...new Set([item.sourceImage, item.image].filter(Boolean))]
  const errors = []
  for (const url of urls) {
    try {
      log(`下载历史壁纸：${date} <- ${url}`)
      return await downloadImage(url)
    } catch (error) {
      errors.push(error.message)
      log(`图片地址不可用，继续尝试备用地址：${error.message}`)
    }
  }

  throw new Error(`无法取得 ${date} 的图片。${errors.join(' | ') || '记录中没有 sourceImage/image 地址'}`)
}

function writeMonthData(file, monthData) {
  monthData.items.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
  monthData.updatedAt = new Date().toISOString()

  const tempFile = `${file}.tmp`
  fs.writeFileSync(tempFile, `${JSON.stringify(monthData, null, 2)}\n`, 'utf8')
  fs.renameSync(tempFile, file)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const config = getConfig()

  // 复用现有 ai-story.js 的 Prompt、图像缩放、JSON 校验和数据结构。
  // 本脚本独立运行，因此只在当前进程内把腾讯云独立配置映射到该模块读取的 AI_* 变量，
  // 不会改变每日 update-bing.yml 的 Secrets/Variables，也不会影响每日生成接口。
  process.env.AI_API_KEY = config.apiKey
  process.env.AI_BASE_URL = config.baseURL
  process.env.AI_MODEL = config.model

  const { generateWallpaperStory } = require('./ai-story')
  const { records, fileCount } = readRecords(config)

  log('========== 历史 AI 解读补充开始 ==========')
  log(`扫描月度 JSON：${fileCount} 个`)
  log(`日期范围：${config.startDate || '最早'} 至 ${config.endDate || '最新'}`)
  log(`处理顺序：日期倒序`)
  log(`强制重新生成：${config.force ? '是' : '否'}`)
  log(`最多成功补充：${config.maxItems} 条`)
  log(`腾讯云模型：${config.model}`)
  log(`候选记录：${records.length} 条`)

  let successCount = 0
  let skippedCount = 0
  let failedCount = 0
  let attemptedCount = 0
  let processedCount = 0
  let consecutiveFailures = 0
  const maxAttempts = config.maxItems * 3

  for (const record of records) {
    if (successCount >= config.maxItems) break

    if (!config.force && hasExistingStory(record.item)) {
      skippedCount += 1
      processedCount += 1
      continue
    }

    if (attemptedCount >= maxAttempts) {
      log(`已达到安全请求上限（${maxAttempts} 次），停止继续扫描。`)
      break
    }

    attemptedCount += 1
    processedCount += 1
    const { item, date, file, monthData } = record

    try {
      log(`开始补充：${date}`)
      const imageBuffer = await loadWallpaperImage(config, item, date)

      const aiStory = await generateWallpaperStory({
        imageBuffer,
        date,
        bing: {
          title: item.title || '',
          description: item.description || '',
          copyright: item.copyright || ''
        }
      })

      if (!aiStory || typeof aiStory.story !== 'string' || !aiStory.story.trim()) {
        throw new Error('AI 返回的故事内容为空，拒绝写入')
      }

      item.aiStory = aiStory
      writeMonthData(file, monthData)

      successCount += 1
      consecutiveFailures = 0
      log(`补充成功：${date}；标题：${aiStory.title}；模型：${aiStory.model}`)
    } catch (error) {
      failedCount += 1
      consecutiveFailures += 1
      log(`补充失败：${date}；原因：${error.message}`)

      // 如果连续失败，通常意味着模型不支持视觉输入、Key/额度错误或接口配置错误；
      // 继续请求只会扩大成本，因此连续失败 5 次后停止。
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log(`连续失败达到 ${MAX_CONSECUTIVE_FAILURES} 次，疑似接口级问题，停止任务。`)
        break
      }
    }

    await sleep(800)
  }

  log('========== 历史 AI 解读补充完成 ==========')
  log(`成功补充：${successCount}`)
  log(`跳过已有：${skippedCount}`)
  log(`失败记录：${failedCount}`)
  log(`实际请求次数：${attemptedCount}`)
  log(`剩余候选（未继续处理）：${Math.max(0, records.length - processedCount)}`)

  if (successCount === 0 && failedCount > 0) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('历史 AI 解读补充任务失败：', error)
    process.exitCode = 1
  })
}

module.exports = {
  hasExistingStory,
  validateDate,
  getLocalUhdPath,
  readRecords,
  writeMonthData
}
