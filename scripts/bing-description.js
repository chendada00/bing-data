
const https = require('https')
const http = require('http')

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Too many redirects'))
      return
    }

    const client = url.startsWith('https:')
      ? https
      : http

    const req = client.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
      }
    }, res => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume()

        const nextUrl = new URL(
          res.headers.location,
          url
        ).toString()

        requestText(nextUrl, redirects + 1)
          .then(resolve)
          .catch(reject)

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
    })

    req.setTimeout(20000, () => {
      req.destroy(new Error('Request timeout'))
    })

    req.on('error', reject)
  })
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
      'i'
    )
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)

    if (match && match[1]) {
      return decodeHtml(match[1])
    }
  }

  return ''
}

function isUsableDescription(value, copyright = '') {
  if (!value || value.length < 30) {
    return false
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .trim()

  if (
    copyright &&
    normalized === copyright.trim()
  ) {
    return false
  }

  // 排除搜索页标题、通用错误页和明显的版权说明。
  if (
    /^(bing|microsoft bing|搜索结果|无法访问|access denied)/i
      .test(normalized)
  ) {
    return false
  }

  return true
}

/**
 * 按壁纸日期请求 Bing 官方图片故事页面。
 *
 * 注意：这是非稳定的网页解析方式，不是有正式兼容性
 * 保证的历史描述 API。只有提取到可用内容才返回。
 */
async function fetchDescription(date, copyright = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error(`Invalid date: ${date}`)
  }

  const compactDate = date.replace(/-/g, '')

  const url =
    'https://www.bing.com/search?q=1' +
    '&filters=' +
    encodeURIComponent(`HpDate:"${compactDate}_1600"`) +
    '&mkt=zh-CN&setlang=zh-cn'

  const html = await requestText(url)

  const candidates = [
    extractMeta(html, 'og:description'),
    extractMeta(html, 'description'),
    extractMeta(html, 'twitter:description')
  ]

  for (const candidate of candidates) {
    if (isUsableDescription(candidate, copyright)) {
      return candidate
    }
  }

  return null
}

module.exports = {
  fetchDescription,
  isUsableDescription
}
