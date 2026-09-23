const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const Jimp = require('jimp')
const Vibrant = require('node-vibrant')
const {
  getColorHistogram,
  isValidColorHistogram
} = require('./color-histogram')
const { buildIndex } = require('./index')

const ASSET_BASE_URL = (process.env.ASSET_BASE_URL || '').replace(/\/$/, '')

if (!ASSET_BASE_URL) {
  throw new Error('ASSET_BASE_URL is not configured')
}

const PREVIEW_MAX_SIZE = 800 * 1024

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildAssetUrl(filePath) {
  return `${ASSET_BASE_URL}/${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

function requestBuffer(url, retry = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http

    const request = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    }, response => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        const redirectUrl = new URL(response.headers.location, url).toString()
        requestBuffer(redirectUrl, retry).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode}: ${url}`))
        return
      }

      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })

    request.setTimeout(30000, () => {
      request.destroy(new Error(`Request timeout: ${url}`))
    })

    request.on('error', error => {
      if (retry < 3) {
        log(`Request failed, retry ${retry + 1}/3: ${error.message}`)
        sleep(2000 * (retry + 1))
          .then(() => requestBuffer(url, retry + 1))
          .then(resolve)
          .catch(reject)
      } else {
        reject(error)
      }
    })
  })
}

async function downloadImage(url) {
  log(`Downloading image: ${url}`)
  const buffer = await requestBuffer(url)

  if (!buffer || buffer.length < 50 * 1024) {
    throw new Error(`Image is too small: ${buffer ? buffer.length : 0} bytes`)
  }

  return buffer
}

function componentToHex(num) {
  const hex = Math.round(num).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

function rgbToHex(rgb) {
  return `#${componentToHex(rgb[0])}${componentToHex(rgb[1])}${componentToHex(rgb[2])}`
}

async function getMainColors(imageBuffer) {
  const image = await Jimp.read(imageBuffer)
  const tempFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'bing-color.jpg')

  await image.writeAsync(tempFile)

  const palette = await new Promise((resolve, reject) => {
    Vibrant.from(tempFile).getPalette((error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })

  const colors = {}

  Object.keys(palette || {}).forEach(key => {
    const swatch = palette[key]
    if (swatch && swatch.rgb) {
      colors[key] = rgbToHex(swatch.rgb)
    }
  })

  return colors
}

async function getBase64(imageBuffer) {
  const image = await Jimp.read(imageBuffer)
  image.resize(16, 9).quality(90)
  return image.getBase64Async(Jimp.MIME_JPEG)
}

async function generatePreview(imageBuffer, previewFile) {
  const source = await Jimp.read(imageBuffer)
  const qualities = [82, 78, 75, 72, 70]

  // 先尝试 1600x900；如果最后一个质量仍然过大，再真正进入 1280x720。
  for (const quality of qualities) {
    const image = source.clone().resize(1600, 900).quality(quality)
    const buffer = await image.getBufferAsync(Jimp.MIME_JPEG)

    log(`Preview attempt: 1600x900, quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`)

    if (buffer.length <= PREVIEW_MAX_SIZE) {
      fs.mkdirSync(path.dirname(previewFile), { recursive: true })
      fs.writeFileSync(previewFile, buffer)
      return { width: 1600, height: 900, quality, size: buffer.length }
    }
  }

  for (const quality of [78, 75, 72, 70]) {
    const image = source.clone().resize(1280, 720).quality(quality)
    const buffer = await image.getBufferAsync(Jimp.MIME_JPEG)

    log(`Preview fallback: 1280x720, quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`)

    if (buffer.length <= PREVIEW_MAX_SIZE || quality === 70) {
      fs.mkdirSync(path.dirname(previewFile), { recursive: true })
      fs.writeFileSync(previewFile, buffer)
      return { width: 1280, height: 720, quality, size: buffer.length }
    }
  }

  throw new Error('Failed to generate preview')
}

function getDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function loadMonthData(jsonFile, year, month) {
  const empty = {
    version: 1,
    year: Number(year),
    month: Number(month),
    updatedAt: null,
    items: []
  }

  if (!fs.existsSync(jsonFile)) return empty

  try {
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    return {
      ...empty,
      ...data,
      items: Array.isArray(data.items) ? data.items : []
    }
  } catch (error) {
    log(`Existing JSON is invalid, rebuilding: ${error.message}`)
    return empty
  }
}

async function main() {
  const date = getDate()
  const year = date.slice(0, 4)
  const month = date.slice(5, 7)

  const jsonFile = path.join('data', year, `${month}.json`)
  const imageFile = path.join('images', year, month, `${date}.jpg`)
  const previewFile = path.join('preview', year, month, `${date}.jpg`)

  log(`Today: ${date}`)

  const monthData = loadMonthData(jsonFile, year, month)
  const existing = monthData.items.find(item => item && item.date === date)
  const imageExists = fs.existsSync(imageFile)
  const previewExists = fs.existsSync(previewFile)

  const isComplete = Boolean(
    imageExists &&
    previewExists &&
    existing &&
    existing.title &&
    existing.description &&
    existing.base64 &&
    existing.color &&
    existing.image &&
    existing.preview &&
    isValidColorHistogram(existing.colorHistogram)
  )

  if (isComplete) {
    log("Today's wallpaper is already complete; rebuilding history index only.")
    buildIndex()
    return
  }

  let imageBuffer
  let actualImageUrl = existing?.sourceImage || null
  let bing = null

  if (imageExists) {
    imageBuffer = fs.readFileSync(imageFile)
    log(`Using existing original image: ${imageFile}`)
  } else {
    const apiUrl = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'
    const apiBuffer = await requestBuffer(apiUrl)
    const bingJson = JSON.parse(apiBuffer.toString('utf8'))

    if (!bingJson.images || !bingJson.images[0]) {
      throw new Error('Bing API returned no image.')
    }

    bing = bingJson.images[0]

    const defaultImageUrl = new URL(bing.url, 'https://cn.bing.com').toString()
    const uhdImageUrl = bing.urlbase
      ? `https://cn.bing.com${bing.urlbase}_UHD.jpg`
      : null

    try {
      if (!uhdImageUrl) throw new Error('Bing API does not provide urlbase.')
      imageBuffer = await downloadImage(uhdImageUrl)
      actualImageUrl = uhdImageUrl
    } catch (error) {
      log(`UHD download failed: ${error.message}`)
      imageBuffer = await downloadImage(defaultImageUrl)
      actualImageUrl = defaultImageUrl
    }

    fs.mkdirSync(path.dirname(imageFile), { recursive: true })
    fs.writeFileSync(imageFile, imageBuffer)
  }

  if (!bing && existing) {
    bing = {
      title: existing.title,
      copyright: existing.copyright || existing.description,
      copyrightlink: existing.copyrightLink,
      url: null,
      urlbase: null,
      hsh: existing.id,
      startdate: existing.startDate,
      fullstartdate: existing.fullStartDate,
      enddate: existing.endDate
    }
  }

  if (!bing) {
    throw new Error('No Bing metadata available for this wallpaper.')
  }

  const image = await Jimp.read(imageBuffer)
  const width = image.bitmap.width
  const height = image.bitmap.height

  const base64 = existing?.base64 || await getBase64(imageBuffer)
  const colors = existing?.color || await getMainColors(imageBuffer)
  const colorHistogram = isValidColorHistogram(existing?.colorHistogram)
    ? existing.colorHistogram
    : await getColorHistogram(imageBuffer)

  if (!previewExists) {
    const previewInfo = await generatePreview(imageBuffer, previewFile)
    log(`Preview generated: ${Math.round(previewInfo.size / 1024)}KB`)
  } else {
    log(`Using existing preview: ${previewFile}`)
  }

  const imageUrl = buildAssetUrl(`images/${year}/${month}/${date}.jpg`)
  const previewUrl = buildAssetUrl(`preview/${year}/${month}/${date}.jpg`)

  const item = {
    date,
    title: bing.title || existing?.title || '',
    description: bing.copyright || existing?.description || '',
    copyright: bing.copyright || existing?.copyright || '',
    copyrightLink: bing.copyrightlink || existing?.copyrightLink || null,
    image: imageUrl,
    preview: previewUrl,
    sourceImage: actualImageUrl || existing?.sourceImage || null,
    base64,
    color: colors,
    colorHistogram,
    width,
    height,
    id: bing.hsh || existing?.id || null,
    startDate: bing.startdate || existing?.startDate || null,
    fullStartDate: bing.fullstartdate || existing?.fullStartDate || null,
    endDate: bing.enddate || existing?.endDate || null
  }

  const index = monthData.items.findIndex(entry => entry && entry.date === date)
  if (index >= 0) monthData.items[index] = item
  else monthData.items.push(item)

  monthData.items.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  monthData.updatedAt = new Date().toISOString()

  fs.mkdirSync(path.dirname(jsonFile), { recursive: true })
  fs.writeFileSync(jsonFile, JSON.stringify(monthData, null, 2) + '\n', 'utf8')

  // 每次每日任务都维护索引；即使今天的数据本来完整，也会执行上面的 buildIndex。
  buildIndex()

  log(`Bing wallpaper update completed: ${date}`)
}

main().catch(error => {
  console.error('========================================')
  console.error('Bing wallpaper update failed.')
  console.error(error)
  console.error('========================================')
  process.exitCode = 1
})
