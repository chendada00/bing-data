
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const { buildIndex } = require('./index')

const DATA_ROOT = path.resolve('data')

const YEAR = (process.env.YEAR || 'all').trim()
const START_DATE = process.env.START_DATE || ''
const END_DATE = process.env.END_DATE || ''
const LIMIT = Number(process.env.LIMIT || 0)
const FORCE = process.env.FORCE === 'true'
const DELAY_MS = Number(process.env.DELAY_MS || 1000)

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeDate(value) {
  const text = String(value || '').trim()

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  return ''
}

function normalizeImageId(value) {
  if (!value) return ''

  let raw = String(value).trim()

  try {
    const parsed = new URL(raw, 'https://www.bing.com')
    raw = parsed.searchParams.get('id') || raw
  } catch {
    // 继续尝试原始字符串。
  }

  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 保留原始值。
  }

  const match = raw.match(/OHR\.[^&?]+/i)
  if (!match) return ''

  return match[0].replace(
    /_(?:\d{3,4}x\d{3,4}|UHD)(?:\.jpg|\.webp)?$/i,
    ''
  )
}

function getItems(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.images)) return data.images
  if (Array.isArray(data?.data)) return data.data
  return []
}

function isBadDescription(item) {
  const description = String(item.description || '').trim()
  const copyright = String(item.copyright || '').trim()

  return (
    !description ||
    description === copyright ||
    /通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(
      description
    )
  )
}

function isUsableDescription(item, description) {
  const text = String(description || '').trim()
  const copyright = String(item.copyright || '').trim()

  return (
    text.length >= 20 &&
    text !== copyright &&
    !/通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(
      text
    )
  )
}

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向次数过多'))
      return
    }

    const client = url.startsWith('https:') ? https : http

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'bing-data-archive-repair',
          Accept: 'application/json'
        }
      },
      res => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()

          requestText(
            new URL(res.headers.location, url).toString(),
            redirects + 1
          ).then(resolve).catch(reject)

          return
        }

        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        const chunks = []

        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf8'))
        })
        res.on('error', reject)
      }
    )

    req.setTimeout(45000, () => {
      req.destroy(new Error('请求超时'))
    })

    req.on('error', reject)
  })
}

async function loadArchiveSources() {
  const allItems = []
  const seen = new Set()

  for (const source of SOURCES) {
    try {
      console.log(`[归档] 正在读取：${source.name}`)

      const text = await requestText(source.url)
      const data = JSON.parse(text)
      const items = getItems(data)

      for (const item of items) {
        const date = normalizeDate(item.date || item.enddate)
        const imageId = normalizeImageId(
          item.urlbase || item.url || item.bing_url
        )
        const description = String(
          item.description || ''
        ).trim()

        if (!date || !isUsableDescription(item, description)) {
          continue
        }

        const key = `${date}|${imageId || ''}|${description}`

        if (seen.has(key)) continue
        seen.add(key)

        allItems.push({
          source: source.name,
          date,
          imageId,
          copyright: String(item.copyright || '').trim(),
          description
        })
      }

      console.log(
        `[归档] ${source.name}：读取 ${items.length} 条，累计有效描述 ${allItems.length} 条`
      )
    } catch (error) {
      console.error(
        `[归档失败] ${source.name}：${error.message}`
      )
    }
  }

  return allItems
}

function findDescription(item, archiveItems) {
  const date = normalizeDate(item.date)
  const imageId = normalizeImageId(
    item.urlbase || item.url || item.sourceImage
  )
  const copyright = String(item.copyright || '').trim()

  const candidates = archiveItems.filter(entry => entry.date === date)

  for (const entry of candidates) {
    if (
      imageId &&
      entry.imageId &&
      imageId !== entry.imageId
    ) {
      continue
    }

    if (
      !entry.imageId &&
      copyright &&
      entry.copyright &&
      copyright !== entry.copyright
    ) {
      continue
    }

    return entry.description
  }

  return ''
}

function collectMonthFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true
  })) {
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

async function main() {
  if (!Number.isInteger(LIMIT) || LIMIT < 0) {
    throw new Error('LIMIT 必须是非负整数')
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

  const archiveItems = await loadArchiveSources()

  if (archiveItems.length === 0) {
    throw new Error('所有 GitHub 归档都没有返回有效描述，停止修复')
  }

  const files = collectMonthFiles(DATA_ROOT).filter(file => {
    if (YEAR === 'all') return true
    return path.basename(path.dirname(file)) === YEAR
  })

  let checked = 0
  let updated = 0
  let skipped = 0
  let missing = 0

  for (const file of files) {
    if (LIMIT > 0 && checked >= LIMIT) break

    const original = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(original)

    if (!Array.isArray(data.items)) continue

    let changed = false

    for (const item of data.items) {
      if (LIMIT > 0 && checked >= LIMIT) break

      const date = normalizeDate(item.date)
      if (!date) continue
      if (START_DATE && date < START_DATE) continue
      if (END_DATE && date > END_DATE) continue

      if (!FORCE && !isBadDescription(item)) {
        skipped++
        continue
      }

      checked++

      const description = findDescription(item, archiveItems)

      if (!description || !isUsableDescription(item, description)) {
        console.log(`[无归档描述] ${date}`)
        missing++
      } else if (item.description === description) {
        skipped++
      } else {
        // 只修改 description，不修改其他字段。
        item.description = description
        changed = true
        updated++

        console.log(`[已更新] ${date}`)
      }

      if (DELAY_MS > 0) {
        await sleep(DELAY_MS)
      }
    }

    if (changed) {
      fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
      )

      console.log(`[已保存] ${path.relative(process.cwd(), file)}`)
    }
  }

  if (updated > 0) {
    buildIndex()
  }

  console.log('========== GitHub 归档描述修复结果 ==========')
  console.log(`检查记录：${checked}`)
  console.log(`更新描述：${updated}`)
  console.log(`跳过记录：${skipped}`)
  console.log(`归档中没有有效描述：${missing}`)
}

main().catch(error => {
  console.error('历史描述修复失败：', error)
  process.exitCode = 1
})
