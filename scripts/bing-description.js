const https = require('https')
const http = require('http')

const BING_HOME_API =
  'https://cn.bing.com/hp/api/model?mkt=zh-CN'

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向次数过多'))
      return
    }

    const client = url.startsWith('https:')
      ? https
      : http

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
        }
      },
      res => {
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
      }
    )

    req.setTimeout(20000, () => {
      req.destroy(new Error('请求超时'))
    })

    req.on('error', reject)
  })
}

function normalizeText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDate(value) {
  const text = String(value || '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }

  const match = text.match(/^(\d{4})(\d{2})(\d{2})[_T]/)

  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }

  return null
}

function isUsableDescription(value, copyright = '') {
  const description = normalizeText(value)
  const normalizedCopyright = normalizeText(copyright)

  if (!description || description.length < 10) {
    return false
  }

  if (
    normalizedCopyright &&
    description === normalizedCopyright
  ) {
    return false
  }

  // 明确拒绝搜索页宣传文案和常见错误页面。
  if (
    /通过必应的智能搜索|获得奖励|快速查找所需内容/i.test(description) ||
    /^(bing|microsoft bing|搜索结果|无法访问|access denied)/i.test(description)
  ) {
    return false
  }

  return true
}

async function fetchDescription(date, copyright = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error(`无效的壁纸日期：${date}`)
  }

  const responseText = await requestText(BING_HOME_API)

  let response

  try {
    response = JSON.parse(responseText)
  } catch (error) {
    throw new Error(`必应主页接口返回的不是有效 JSON：${error.message}`)
  }

  if (!response || !Array.isArray(response.MediaContents)) {
    throw new Error('必应主页接口中没有 MediaContents 数组')
  }

  const target = response.MediaContents.find(item => {
    const itemDate = normalizeDate(item && item.Ssd)
    return itemDate === date
  })

  if (!target || !target.ImageContent) {
    // 不能拿其他日期的描述来填充当前记录。
    return null
  }

  const description = normalizeText(
    target.ImageContent.Description
  )

  if (!isUsableDescription(description, copyright)) {
    return null
  }

  return description
}

module.exports = {
  fetchDescription,
  isUsableDescription
}