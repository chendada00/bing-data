
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
const DELAY_MS = Number(process.env.DELAY_MS || 1200)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

/**
 * Bing 的 enddate 是壁纸展示日期；
 * 故事页 HpDate 通常使用 fullstartdate 对应的日期。
 *
 * 优先读取记录中的 fullStartDate / fullstartdate，
 * 如果不存在，则按展示日期减一天计算。
 */
function getStoryDate(item, displayDate) {
  const fullStartDate =
    item.fullStartDate ||
    item.fullstartdate ||
    ''

  const match = String(fullStartDate).match(/^(\d{8})/)

  if (match) {
    return match[1]
  }

  const [year, month, day] = displayDate
    .split('-')
    .map(Number)

  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - 1)

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('')
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

    const parentYear = path.basename(path.dirname(fullPath))

    if (
      entry.isFile() &&
      /^\d{4}$/.test(parentYear) &&
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
    /通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(
      description
    )
  )
}

function isUsableDescription(value, copyright = '') {
  const description = String(value || '').trim()

  return (
    description.length >= 20 &&
    description !== String(copyright || '').trim() &&
    !/通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(
      description
    )
  )
}

/**
 * 获取网页 HTML，支持重定向和超时。
 */
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
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language':
            'zh-CN,zh;q=0.9,en;q=0.5'
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

/**
 * 从 HTML 的 var _model = {...}; 中提取 JSON。
 *
 * 使用大括号配对，而不是用一个简单的贪婪正则，
 * 避免模型内字符串或嵌套对象导致截取错误。
 */
function parseEmbeddedModel(html) {
  const marker = /(?:var\s+_model|_model)\s*=\s*/.exec(html)

  if (!marker) {
    throw new Error('故事页面中没有找到 _model 数据')
  }

  const start = html.indexOf('{', marker.index + marker[0].length)

  if (start < 0) {
    throw new Error('故事页面中的 _model 没有 JSON 对象')
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const char = html[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--

      if (depth === 0) {
        const jsonText = html.slice(start, i + 1)
        return JSON.parse(jsonText)
      }
    }
  }

  throw new Error('_model JSON 不完整')
}

function getModelEntries(model) {
  return [
    ...(Array.isArray(model.MediaContents)
      ? model.MediaContents
      : []),
    ...(Array.isArray(model.PreloadMediaContents)
      ? model.PreloadMediaContents
      : [])
  ]
}

/**
 * 按壁纸日期访问必应官方故事页。
 */
async function fetchOfficialStoryDescription(item, date) {
  const storyDate = getStoryDate(item, date)

  const filter = `HpDate:"${storyDate}_1600"`

  const url =
    'https://cn.bing.com/search?q=1&filters=' +
    encodeURIComponent(filter)

  const html = await requestText(url)
  const model = parseEmbeddedModel(html)
  const entries = getModelEntries(model)

  const candidates = entries
    .map(entry => ({
      entry,
      description: String(
        entry?.ImageContent?.Description ||
        entry?.Description ||
        ''
      ).trim(),
      backstageUrl: String(
        entry?.BackstageUrl ||
        entry?.ImageContent?.BackstageUrl ||
        ''
      )
    }))
    .filter(candidate =>
      isUsableDescription(
        candidate.description,
        item.copyright || ''
      )
    )

  // 如果模型有日期标记，优先选择日期完全匹配的记录。
  const dateMatched = candidates.find(candidate =>
    candidate.backstageUrl.includes(storyDate)
  )

  const selected = dateMatched || candidates[0]

  if (!selected) {
    throw new Error(
      `官方故事页没有返回有效描述（展示日期 ${date}，故事日期 ${storyDate}）`
    )
  }

  return selected.description
}

async function main() {
  if (LIMIT < 0 || !Number.isInteger(LIMIT)) {
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

  const files = collectMonthFiles(DATA_ROOT).filter(file => {
    if (YEAR === 'all') return true
    return path.basename(path.dirname(file)) === YEAR
  })

  let checked = 0
  let updated = 0
  let skipped = 0
  let missing = 0
  let failed = 0

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

      try {
        const description = await fetchOfficialStoryDescription(
          item,
          date
        )

        if (!isUsableDescription(description, item.copyright)) {
          console.log(`[跳过] ${date}：描述内容未通过验证`)
          missing++
          continue
        }

        if (item.description === description) {
          skipped++
          continue
        }

        // 月度记录只修改 description 字段。
        item.description = description
        changed = true
        updated++

        console.log(`[已更新] ${date}`)
      } catch (error) {
        failed++
        console.error(`[获取失败] ${date}：${error.message}`)
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

  console.log('========== 历史描述修复结果 ==========')
  console.log(`检查记录：${checked}`)
  console.log(`更新描述：${updated}`)
  console.log(`跳过记录：${skipped}`)
  console.log(`无有效描述：${missing}`)
  console.log(`请求或解析失败：${failed}`)

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('历史描述修复失败：', error)
  process.exitCode = 1
})
