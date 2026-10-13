
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const { buildIndex } = require('./index')

const DATA_ROOT = path.resolve('data')

const SOURCE_URL =
  'https://raw.githubusercontent.com/zigou23/Bing-Daily-Wallpaper/main/bing/bing_zh-CN.json'

const YEAR = (process.env.YEAR || 'all').trim()
const START_DATE = process.env.START_DATE || ''
const END_DATE = process.env.END_DATE || ''
const LIMIT = Number(process.env.LIMIT || 0)
const FORCE = process.env.FORCE === 'true'
const DELAY_MS = Number(process.env.DELAY_MS || 0)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
          'User-Agent': 'bing-data-description-repair',
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

    req.setTimeout(30000, () => {
      req.destroy(new Error('请求超时'))
    })

    req.on('error', reject)
  })
}

function normalizeDate(value) {
  const text = String(value || '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }

  return null
}

function collectMonthFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const result = []

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true
  })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      result.push(...collectMonthFiles(fullPath))
      continue
    }

    const year = path.basename(path.dirname(fullPath))

    if (
      entry.isFile() &&
      /^\d{4}$/.test(year) &&
      /^\d{2}\.json$/.test(entry.name)
    ) {
      result.push(fullPath)
    }
  }

  return result.sort()
}

function needsRepair(item) {
  const description = String(item.description || '').trim()
  const copyright = String(item.copyright || '').trim()

  return (
    !description ||
    description === copyright ||
    /通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(description)
  )
}

async function main() {
  console.log('正在获取中文必应壁纸历史描述数据……')

  const sourceText = await requestText(SOURCE_URL)
  const sourceItems = JSON.parse(sourceText)

  if (!Array.isArray(sourceItems)) {
    throw new Error('远程数据格式错误：预期 JSON 数组')
  }

  const descriptions = new Map()

  for (const source of sourceItems) {
    const date = normalizeDate(source.date)
    const description = String(source.description || '').trim()

    if (date && description) {
      descriptions.set(date, description)
    }
  }

  console.log(`远程数据包含 ${descriptions.size} 条有效描述`)

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

      if (!FORCE && !needsRepair(item)) {
        skipped++
        continue
      }

      checked++

      const description = descriptions.get(date)

      if (!description) {
        console.log(`[跳过] ${date}：远程仓库没有该日期的描述`)
        missing++
        continue
      }

      // 只更新 description，其他字段不做任何赋值。
      if (item.description === description) {
        skipped++
        continue
      }

      item.description = description
      changed = true
      updated++

      console.log(`[已更新] ${date}`)

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

  console.log('========== 描述修复结果 ==========')
  console.log(`检查记录：${checked}`)
  console.log(`更新描述：${updated}`)
  console.log(`跳过记录：${skipped}`)
  console.log(`远程缺失：${missing}`)
}

main().catch(error => {
  console.error('描述修复失败：', error)
  process.exitCode = 1
})
