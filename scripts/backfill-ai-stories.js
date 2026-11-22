#!/usr/bin/env node
'use strict'

/**
 * 历史壁纸 AI 解读回填
 *
 * - 直接复用每日 update-bing.yml 的 AI_API_KEY / AI_BASE_URL / AI_MODEL
 * - 不创建第二套 AI 接口，不切换服务商
 * - 日期倒序，只处理没有有效 aiStory.story 的记录
 * - 默认最多成功补充 5 条，硬上限也是 5 条
 * - 每成功一条立即写回月度 JSON
 * - 只读取本地 preview 或 item.preview，绝不下载 UHD
 */

const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const DATA_ROOT = path.join(ROOT, 'data')
const DEFAULT_MAX_ITEMS = 5
const MAX_ITEMS_LIMIT = 10
const MAX_CONSECUTIVE_FAILURES = 5
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

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

  // 留空时默认 10；即使手动传入更大的数字，也硬限制为 10。
  const rawMaxItems = process.env.MAX_ITEMS == null || process.env.MAX_ITEMS === ''
    ? String(DEFAULT_MAX_ITEMS)
    : String(process.env.MAX_ITEMS).trim()

  if (!/^\d+$/.test(rawMaxItems)) {
    throw new Error('MAX_ITEMS 必须是 1 到 10 之间的整数')
  }

  const requestedMaxItems = Number(rawMaxItems)
  if (requestedMaxItems < 1) {
    throw new Error('MAX_ITEMS 必须是 1 到 10 之间的整数')
  }

  const apiKey = String(process.env.AI_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('缺少 AI_API_KEY；请复用每日 update-bing workflow 使用的 Secret')
  }

  return {
    startDate,
    endDate,
    force: parseBoolean(process.env.FORCE, false),
    maxItems: Math.min(requestedMaxItems, MAX_ITEMS_LIMIT),
    previewRoot: path.resolve(process.env.PREVIEW_ROOT || 'preview')
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

  // 日期倒序：先补最新的缺失记录。
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

function getLocalPreviewPath(config, date) {
  const year = date.slice(0, 4)
  const month = date.slice(5, 7)
  return path.join(config.previewRoot, year, month, `${date}.jpg`)
}

async function validateImageBuffer(buffer, source) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10 * 1024) {
    throw new Error(`图片内容为空或过小：${source}`)
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 限制：${source}`)
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
    throw new Error(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 限制：${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return validateImageBuffer(buffer, url)
}

async function loadWallpaperImage(config, item, date) {
  // 优先读取仓库中的 preview 文件。
  const localPath = getLocalPreviewPath(config, date)
  if (fs.existsSync(localPath)) {
    try {
      const buffer = fs.readFileSync(localPath)
      await validateImageBuffer(buffer, localPath)
      log(`使用本地预览图：${path.relative(ROOT, localPath)}`)
      return buffer
    } catch (error) {
      log(`本地预览图不可用，尝试 JSON 中的 preview 地址：${error.message}`)
    }
  }

  // 严格只使用 item.preview，绝不回退到 sourceImage / image（可能是 UHD）。
  if (!item.preview) {
    throw new Error(`记录 ${date} 没有 preview 地址，且本地预览图不存在：${path.relative(ROOT, localPath)}`)
  }

  log(`下载预览图：${date} <- ${item.preview}`)
  return downloadImage(item.preview)
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

  // 不在这里覆盖 AI_* 环境变量。它们由 workflow 直接从每日更新任务的
  // 同一组 Secrets / Variables 注入，ai-story.js 会原样读取。
  const { generateWallpaperStory } = require('./ai-story')
  const { records, fileCount } = readRecords(config)

  log('========== 历史 AI 解读补充开始 ==========')
  log(`扫描月度 JSON：${fileCount} 个`)
  log(`日期范围：${config.startDate || '最早'} 至 ${config.endDate || '最新'}`)
  log('处理顺序：日期倒序')
  log(`强制重新生成：${config.force ? '是' : '否'}`)
  log(`最多成功补充：${config.maxItems} 条（硬上限 ${MAX_ITEMS_LIMIT}）`)
  log(`AI_BASE_URL：${process.env.AI_BASE_URL || '使用 ai-story.js 默认值'}`)
  log(`AI_MODEL：${process.env.AI_MODEL || '使用 ai-story.js 默认值'}`)
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
  log(`实际调用尝试次数：${attemptedCount}`)
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
  getLocalPreviewPath,
  readRecords,
  writeMonthData
}
