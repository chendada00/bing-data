const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')
const { buildIndex } = require('./index')

const DATA_ROOT = path.resolve('data')
const YEAR = (process.env.YEAR || 'all').trim()
const START_DATE = (process.env.START_DATE || '').trim()
const END_DATE = (process.env.END_DATE || '').trim()
const LIMIT = Number(process.env.LIMIT || 0)
const DRY_RUN = process.env.DRY_RUN === 'true'

const SOURCES = [
  {
    name: 'Bing-Daily-Wallpaper 当前归档',
    url: 'https://raw.githubusercontent.com/zigou23/Bing-Daily-Wallpaper/main/bing/bing_zh-CN.json'
  },
  {
    name: 'Bing-Daily-Wallpaper 历史归档',
    url: 'https://raw.githubusercontent.com/zigou23/Bing-Daily-Wallpaper/main/bing/old-2408/bing_zh-CN.json'
  },
  {
    name: 'Bing-Wallpaper-Archive',
    url: 'https://raw.githubusercontent.com/npanuhin/Bing-Wallpaper-Archive/master/api/CN/zh.json'
  }
]

function normalizeDate(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (/^\d{8}$/.test(text)) {
    return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8)
  }
  return ''
}

function normalizeImageId(value) {
  if (!value) return ''
  let raw = String(value).trim()

  try {
    const parsed = new URL(raw, 'https://www.bing.com')
    raw = parsed.searchParams.get('id') || raw
  } catch {}

  try {
    raw = decodeURIComponent(raw)
  } catch {}

  const match = raw.match(/OHR\.[^&?]+/i)
  if (!match) return ''

  return match[0].replace(
    /_(?:\d{3,4}x\d{3,4}|UHD)(?:\.jpg|\.jpeg|\.png|\.webp)?$/i,
    ''
  )
}

function getItems(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data && data.images)) return data.images
  if (Array.isArray(data && data.data)) return data.data
  return []
}

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向次数过多：' + url))
      return
    }

    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, {
      headers: {
        'User-Agent': 'bing-data-description-repair',
        Accept: 'application/json'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        requestText(new URL(res.headers.location, url).toString(), redirects + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('HTTP ' + res.statusCode + '：' + url))
        return
      }

      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })

    req.setTimeout(45000, () => req.destroy(new Error('请求超时：' + url)))
    req.on('error', reject)
  })
}

function normalizeArchiveRecord(source, sourceName) {
  const imageId = normalizeImageId(
    source.urlbase || source.url || source.bing_url
  )

  const record = {
    sourceName,
    date: normalizeDate(source.date || source.enddate),
    imageId,
    description: String(source.description || '').trim(),
    copyright: String(source.copyright || '').trim()
  }

  if (!imageId || (!record.description && !record.copyright)) {
    return null
  }

  return record
}

async function loadArchiveRecords() {
  const byImageId = new Map()

  for (const source of SOURCES) {
    try {
      console.log('[归档] 正在读取：' + source.name)
      const data = JSON.parse(await requestText(source.url))
      const items = getItems(data)
      let accepted = 0

      for (const raw of items) {
        const record = normalizeArchiveRecord(raw, source.name)
        if (!record) continue
        accepted++

        // 只按图片 ID 关联字段，不按日期关联，防止相邻日期错位。
        // SOURCES 按优先级排列：当前归档优先于历史归档。
        const existing = byImageId.get(record.imageId)
        if (!existing) {
          byImageId.set(record.imageId, record)
        } else {
          // 同一图片优先补齐空字段，不覆盖已存在的高优先级非空字段。
          for (const key of ['description', 'copyright']) {
            if (!existing[key] && record[key]) {
              existing[key] = record[key]
            }
          }
        }
      }

      console.log(
        '[归档] ' + source.name + '：读取 ' + items.length +
        ' 条，识别 ' + accepted + ' 条带图片 ID 的记录'
      )
    } catch (error) {
      console.error('[归档失败] ' + source.name + '：' + error.message)
    }
  }

  if (byImageId.size === 0) {
    throw new Error('所有归档均未提供可用的图片 ID 数据，已停止修复')
  }

  return byImageId
}

function collectMonthFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectMonthFiles(fullPath))
    } else if (
      entry.isFile() &&
      /^\d{2}\.json$/.test(entry.name) &&
      /^\d{4}$/.test(path.basename(path.dirname(fullPath)))
    ) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

function getTargetImageId(item) {
  // sourceImage is the most explicit identity; image URL also contains OHR ID.
  return normalizeImageId(item.sourceImage || item.urlbase || item.image || item.url)
}

function setIfDifferent(item, field, value, changedFields) {
  if (typeof value !== 'string') return

  const nextValue = value.trim()
  if (!nextValue) return

  const currentValue =
    typeof item[field] === 'string'
      ? item[field].trim()
      : ''

  // 忽略首尾空格差异；内容相同就不写入。
  if (currentValue === nextValue) return

  item[field] = nextValue
  changedFields.push(field)
}

async function main() {
  if (!Number.isInteger(LIMIT) || LIMIT < 0) {
    throw new Error('LIMIT 必须是非负整数')
  }
  if (YEAR !== 'all' && !/^\d{4}$/.test(YEAR)) {
    throw new Error('YEAR 必须是 all 或四位年份')
  }
  if (START_DATE && !normalizeDate(START_DATE)) {
    throw new Error('START_DATE 格式必须为 YYYY-MM-DD')
  }
  if (END_DATE && !normalizeDate(END_DATE)) {
    throw new Error('END_DATE 格式必须为 YYYY-MM-DD')
  }
  if (START_DATE && END_DATE && START_DATE > END_DATE) {
    throw new Error('START_DATE 不能晚于 END_DATE')
  }

  const archives = await loadArchiveRecords()
  const files = collectMonthFiles(DATA_ROOT).filter(file =>
    YEAR === 'all' || path.basename(path.dirname(file)) === YEAR
  )

  let checked = 0
  let matched = 0
  let updatedRecords = 0
  let updatedFields = 0
  let missingMatch = 0
  const unresolved = []

  for (const file of files) {
    if (LIMIT > 0 && checked >= LIMIT) break

    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(data.items)) continue
    let changed = false

    for (const item of data.items) {
      if (LIMIT > 0 && checked >= LIMIT) break

      const date = normalizeDate(item.date)
      if (!date) continue
      if (START_DATE && date < START_DATE) continue
      if (END_DATE && date > END_DATE) continue

      checked++
      const imageId = getTargetImageId(item)
      const archive = imageId ? archives.get(imageId) : null

      if (!archive) {
        missingMatch++
        unresolved.push(date + ' (' + (imageId || 'no-image-id') + ')')
        console.log('[未匹配] ' + date + '：归档中找不到相同图片 ID')
        continue
      }

      matched++
      const changedFields = []

      setIfDifferent(
        item,
        'description',
        archive.description,
        changedFields
      )

      setIfDifferent(
        item,
        'copyright',
        archive.copyright,
        changedFields
      )

      if (changedFields.length) {
        updatedRecords++
        updatedFields += changedFields.length
        changed = true
        console.log(
          '[' + (DRY_RUN ? '预览' : '修复') + '] ' + date + '：' +
          changedFields.join(', ') + '（图片 ID ' + imageId +
          '，来源 ' + archive.sourceName + '）'
        )
      }
    }

    if (changed && !DRY_RUN) {
      fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
      )

      console.log('[已保存] ' + path.relative(process.cwd(), file))
    }
  }

  if (updatedRecords > 0 && !DRY_RUN) buildIndex()

  console.log('')
  console.log('========== 壁纸描述 / 版权修复结果 ==========')
  console.log('模式：' + (DRY_RUN ? '只检查，不写入' : '修复并写入'))
  console.log('检查记录：' + checked)
  console.log('按图片 ID 匹配：' + matched)
  console.log('修复记录数：' + updatedRecords)
  console.log('修复字段数：' + updatedFields)
  console.log('未匹配记录：' + missingMatch)

  if (unresolved.length) {
    console.log('未匹配日期（最多展示 100 条）：')
    unresolved.slice(0, 100).forEach(line => console.log('- ' + line))
  }
  if (missingMatch && !DRY_RUN) {
    console.warn(
      '部分记录未能按图片 ID 匹配。为避免错配，脚本保留这些记录的原值，请根据清单核查。'
    )
  }
}

main().catch(error => {
  console.error('壁纸描述 / 版权修复失败：', error)
  process.exitCode = 1
})
