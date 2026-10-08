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

const {
  buildIndex
} = require('./index')

const PREVIEW_BASE_URL = (
  process.env.PREVIEW_BASE_URL || ''
).replace(/\/$/, '')

const IMAGE_BASE_URL = (
  process.env.IMAGE_BASE_URL || ''
).replace(/\/$/, '')

const HISTORY_SOURCE_BASE_URL = (
  process.env.HISTORY_SOURCE_BASE_URL || ''
).replace(/\/$/, '')

const UHD_ROOT = path.resolve(
  process.env.UHD_ROOT || '../bing-uhd'
)

const MODE = (
  process.env.MODE || 'check'
).trim().toLowerCase()

const YEAR = (
  process.env.YEAR || 'all'
).trim()

const MAX_IMAGES = Number(
  process.env.MAX_IMAGES || 0
)

const MIN_UHD_WIDTH = 3000
const MIN_UHD_HEIGHT = 1600
const EXPECTED_UHD_WIDTH = 3840
const EXPECTED_UHD_HEIGHT = 2160

const PREVIEW_MAX_SIZE = 800 * 1024

const COLOR_KEYS = [
  'Vibrant',
  'DarkVibrant',
  'LightVibrant',
  'Muted',
  'DarkMuted',
  'LightMuted'
]

function log(message) {
  console.log(
    `[${new Date().toISOString()}] ${message}`
  )
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

function fail(message) {
  throw new Error(message)
}

function normalizeDate(value) {
  if (!value) return null

  const text = String(value).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }

  return null
}

function parseDate(date) {
  const normalized = normalizeDate(date)

  if (!normalized) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    normalized
  )

  if (!match) return null

  return {
    date: normalized,
    year: match[1],
    month: match[2]
  }
}

function buildRelativePath(type, date) {
  const parsed = parseDate(date)

  if (!parsed) return null

  return `${type}/${parsed.year}/${parsed.month}/${parsed.date}.jpg`
}

function buildAssetUrl(baseUrl, relativePath) {
  if (!baseUrl || !relativePath) {
    return null
  }

  return `${baseUrl}/${relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')}`
}

function buildPreviewUrl(date) {
  return buildAssetUrl(
    PREVIEW_BASE_URL,
    buildRelativePath('preview', date)
  )
}

function buildImageUrl(date) {
  return buildAssetUrl(
    IMAGE_BASE_URL,
    buildRelativePath('images', date)
  )
}

function buildUhdFile(date) {
  const parsed = parseDate(date)

  if (!parsed) {
    throw new Error(`Invalid date: ${date}`)
  }

  return path.join(
    UHD_ROOT,
    'images',
    parsed.year,
    parsed.month,
    `${parsed.date}.jpg`
  )
}

function buildOfficialUhdUrl(urlbase) {
  if (!urlbase) return null

  let normalized = String(urlbase).trim()

  if (!normalized) return null

  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://')
  ) {
    try {
      const parsed = new URL(normalized)

      return `${parsed.origin}${parsed.pathname}_UHD.jpg${parsed.search}`
    } catch {
      return null
    }
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }

  return `https://www.bing.com${normalized}_UHD.jpg`
}

function requestBuffer(url, retry = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://')
      ? https
      : http

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          'Accept':
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://www.bing.com/'
        }
      },
      response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume()

          const redirectUrl = new URL(
            response.headers.location,
            url
          ).toString()

          requestBuffer(
            redirectUrl,
            retry
          )
            .then(resolve)
            .catch(reject)

          return
        }

        if (response.statusCode !== 200) {
          response.resume()

          reject(
            new Error(
              `HTTP ${response.statusCode}: ${url}`
            )
          )

          return
        }

        const chunks = []

        response.on('data', chunk => {
          chunks.push(chunk)
        })

        response.on('end', () => {
          resolve(
            Buffer.concat(chunks)
          )
        })

        response.on('error', reject)
      }
    )

    request.setTimeout(
      60000,
      () => {
        request.destroy(
          new Error(
            `Request timeout: ${url}`
          )
        )
      }
    )

    request.on('error', error => {
      if (retry < 3) {
        log(
          `Request failed, retry ${retry + 1}/3: ${error.message}`
        )

        sleep(
          2000 * (retry + 1)
        )
          .then(() =>
            requestBuffer(
              url,
              retry + 1
            )
          )
          .then(resolve)
          .catch(reject)

        return
      }

      reject(error)
    })
  })
}

async function downloadImage(url) {
  log(`Downloading UHD: ${url}`)

  const buffer =
    await requestBuffer(url)

  if (
    !buffer ||
    buffer.length < 100 * 1024
  ) {
    throw new Error(
      `Downloaded image is too small: ${
        buffer ? buffer.length : 0
      } bytes`
    )
  }

  return buffer
}

async function readImageInfo(buffer) {
  const image =
    await Jimp.read(buffer)

  return {
    image,
    width: image.bitmap.width,
    height: image.bitmap.height
  }
}

function isValidUhdDimension(
  width,
  height
) {
  return (
    Number(width) >= MIN_UHD_WIDTH &&
    Number(height) >= MIN_UHD_HEIGHT
  )
}

async function validateUhdBuffer(
  buffer
) {
  const info =
    await readImageInfo(buffer)

  return {
    ...info,
    valid: isValidUhdDimension(
      info.width,
      info.height
    ),
    exact:
      info.width === EXPECTED_UHD_WIDTH &&
      info.height === EXPECTED_UHD_HEIGHT
  }
}

async function loadImageFromFile(
  file
) {
  if (!fs.existsSync(file)) {
    return null
  }

  try {
    const buffer =
      fs.readFileSync(file)

    const result =
      await validateUhdBuffer(buffer)

    if (!result.valid) {
      return null
    }

    return {
      ...result,
      buffer
    }
  } catch {
    return null
  }
}

async function getBase64(
  imageBuffer
) {
  const image =
    await Jimp.read(imageBuffer)

  image
    .resize(16, 9)
    .quality(90)

  return image.getBase64Async(
    Jimp.MIME_JPEG
  )
}

function isValidBase64(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith(
      'data:image/jpeg;base64,'
    )
  ) {
    return false
  }

  const encoded =
    value.slice(
      'data:image/jpeg;base64,'.length
    )

  if (!encoded) return false

  if (
    encoded.length < 100
  ) {
    return false
  }

  try {
    const buffer =
      Buffer.from(
        encoded,
        'base64'
      )

    return (
      buffer.length > 50 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8
    )
  } catch {
    return false
  }
}

function componentToHex(num) {
  const hex =
    Math.round(num).toString(16)

  return hex.length === 1
    ? `0${hex}`
    : hex
}

function rgbToHex(rgb) {
  return (
    `#${componentToHex(rgb[0])}` +
    `${componentToHex(rgb[1])}` +
    `${componentToHex(rgb[2])}`
  )
}

function isValidHexColor(value) {
  return (
    typeof value === 'string' &&
    /^#[0-9a-f]{6}$/i.test(
      value
    )
  )
}

function isValidColor(color) {
  if (
    !color ||
    typeof color !== 'object' ||
    Array.isArray(color)
  ) {
    return false
  }

  return COLOR_KEYS.some(key =>
    isValidHexColor(color[key])
  )
}

async function getMainColors(
  imageBuffer
) {
  const image =
    await Jimp.read(imageBuffer)

  const tempFile = path.join(
    process.env.RUNNER_TEMP ||
      '/tmp',
    `bing-color-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.jpg`
  )

  await image.writeAsync(
    tempFile
  )

  try {
    const palette =
      await new Promise(
        (resolve, reject) => {
          Vibrant.from(
            tempFile
          ).getPalette(
            (error, result) => {
              if (error) {
                reject(error)
              } else {
                resolve(result)
              }
            }
          )
        }
      )

    const colors = {}

    COLOR_KEYS.forEach(key => {
      const swatch =
        palette &&
        palette[key]

      if (
        swatch &&
        Array.isArray(
          swatch.rgb
        )
      ) {
        colors[key] =
          rgbToHex(
            swatch.rgb
          )
      }
    })

    return colors
  } finally {
    try {
      fs.unlinkSync(
        tempFile
      )
    } catch {
      // ignore
    }
  }
}

function isValidDate(
  date
) {
  return Boolean(
    parseDate(date)
  )
}

function isValidText(
  value
) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  )
}

function isValidCopyrightLink(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return false
  }

  if (
    typeof value !== 'string'
  ) {
    return false
  }

  try {
    const url =
      new URL(value)

    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    )
  } catch {
    return false
  }
}

function isOfficialUhdUrl(
  value
) {
  return (
    typeof value === 'string' &&
    /_UHD\.jpg(?:\?.*)?$/i.test(
      value
    )
  )
}

function isValidSourceImage(
  value
) {
  return (
    isOfficialUhdUrl(value) &&
    /^https?:\/\/(?:www|cn)\.bing\.com\//i.test(
      value
    )
  )
}

function normalizeSourceRecord(
  record
) {
  if (!record) return null

  const date =
    normalizeDate(
      record.date
    )

  if (!date) return null

  return {
    date,
    title:
      typeof record.title === 'string'
        ? record.title.trim()
        : '',
    copyright:
      typeof record.copyright === 'string'
        ? record.copyright.trim()
        : '',
    copyrightLink:
      typeof record.copyrightlink === 'string'
        ? record.copyrightlink.trim()
        : null,
    url:
      typeof record.url === 'string'
        ? record.url.trim()
        : null,
    urlbase:
      typeof record.urlbase === 'string'
        ? record.urlbase.trim()
        : null,
    uhd:
      record.uhd === true
  }
}

async function fetchJson(
  url
) {
  const buffer =
    await requestBuffer(url)

  return JSON.parse(
    buffer.toString('utf8')
  )
}

async function loadHistorySource(
  year
) {
  if (
    !HISTORY_SOURCE_BASE_URL
  ) {
    fail(
      'HISTORY_SOURCE_BASE_URL is not configured'
    )
  }

  const url =
    `${HISTORY_SOURCE_BASE_URL}/${year}.json`

  log(
    `Loading history source: ${url}`
  )

  const data =
    await fetchJson(url)

  if (!Array.isArray(data)) {
    throw new Error(
      `History source is not an array: ${url}`
    )
  }

  return data
    .map(normalizeSourceRecord)
    .filter(Boolean)
}

function collectMonthFiles(
  dir
) {
  if (!fs.existsSync(dir)) {
    return []
  }

  const result = []

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true }
    )
  ) {
    const fullPath =
      path.join(
        dir,
        entry.name
      )

    if (
      entry.isDirectory()
    ) {
      result.push(
        ...collectMonthFiles(
          fullPath
        )
      )

      continue
    }

    const year =
      path.basename(
        path.dirname(fullPath)
      )

    if (
      entry.isFile() &&
      /^\d{4}$/.test(year) &&
      /^\d{2}\.json$/.test(
        entry.name
      )
    ) {
      result.push(fullPath)
    }
  }

  return result.sort()
}

function loadLocalData() {
  const DATA_ROOT =
    path.resolve('data')

  const files =
    collectMonthFiles(
      DATA_ROOT
    )

  const records =
    new Map()

  const fileData =
    new Map()

  for (
    const file of files
  ) {
    let data

    try {
      data = JSON.parse(
        fs.readFileSync(
          file,
          'utf8'
        )
      )
    } catch (error) {
      throw new Error(
        `Invalid JSON: ${file}: ${error.message}`
      )
    }

    if (
      !Array.isArray(
        data.items
      )
    ) {
      continue
    }

    fileData.set(
      file,
      data
    )

    for (
      const item of data.items
    ) {
      if (
        !item ||
        !isValidDate(
          item.date
        )
      ) {
        continue
      }

      records.set(
        normalizeDate(item.date),
        {
          item,
          file
        }
      )
    }
  }

  return {
    files,
    records,
    fileData
  }
}

function collectUhdFiles() {
  const root =
    path.join(
      UHD_ROOT,
      'images'
    )

  if (!fs.existsSync(root)) {
    return []
  }

  const result = []

  function walk(dir) {
    for (
      const entry of fs.readdirSync(
        dir,
        { withFileTypes: true }
      )
    ) {
      const fullPath =
        path.join(
          dir,
          entry.name
        )

      if (
        entry.isDirectory()
      ) {
        walk(fullPath)
        continue
      }

      if (
        entry.isFile() &&
        /\.jpg$/i.test(
          entry.name
        )
      ) {
        result.push(fullPath)
      }
    }
  }

  walk(root)

  return result.sort()
}

function getDateFromUhdPath(
  file
) {
  const relative =
    path.relative(
      path.join(
        UHD_ROOT,
        'images'
      ),
      file
    )

  const normalized =
    relative.replace(
      /\\/g,
      '/'
    )

  const match =
    /^(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})\.jpg$/i.exec(
      normalized
    )

  return match
    ? match[3]
    : null
}

function validateHistogram(
  histogram
) {
  if (
    !isValidColorHistogram(
      histogram
    )
  ) {
    return false
  }

  if (
    !Array.isArray(
      histogram.bins
    )
  ) {
    return false
  }

  if (
    histogram.bins.length !== 108
  ) {
    return false
  }

  return histogram.bins.every(
    value =>
      Number.isInteger(
        Number(value)
      ) &&
      Number(value) >= 0 &&
      Number(value) <= 255
  )
}

function getMissingFields(
  item
) {
  const missing = []

  if (!isValidDate(item.date)) {
    missing.push('date')
  }

  if (!isValidText(item.title)) {
    missing.push('title')
  }

  if (!isValidText(item.description)) {
    missing.push('description')
  }

  if (!isValidText(item.copyright)) {
    missing.push('copyright')
  }

  if (!isValidCopyrightLink(
    item.copyrightLink
  )) {
    missing.push('copyrightLink')
  }

  if (!isValidText(item.image)) {
    missing.push('image')
  }

  if (!isValidText(item.preview)) {
    missing.push('preview')
  }

  if (!isValidSourceImage(
    item.sourceImage
  )) {
    missing.push('sourceImage')
  }

  if (!isValidBase64(
    item.base64
  )) {
    missing.push('base64')
  }

  if (!isValidColor(
    item.color
  )) {
    missing.push('color')
  }

  if (!validateHistogram(
    item.colorHistogram
  )) {
    missing.push(
      'colorHistogram'
    )
  }

  if (
    !Number.isInteger(
      Number(item.width)
    ) ||
    Number(item.width) <= 0
  ) {
    missing.push('width')
  }

  if (
    !Number.isInteger(
      Number(item.height)
    ) ||
    Number(item.height) <= 0
  ) {
    missing.push('height')
  }

  return missing
}

function ensureMonthData(
  fileData,
  date
) {
  const parsed =
    parseDate(date)

  if (!parsed) {
    throw new Error(
      `Invalid date: ${date}`
    )
  }

  const file =
    path.join(
      'data',
      parsed.year,
      `${parsed.month}.json`
    )

  let data =
    fileData.get(
      path.resolve(file)
    )

  if (!data) {
    data = {
      version: 1,
      year: Number(
        parsed.year
      ),
      month: Number(
        parsed.month
      ),
      updatedAt: null,
      items: []
    }

    fileData.set(
      path.resolve(file),
      data
    )
  }

  if (
    !Array.isArray(
      data.items
    )
  ) {
    data.items = []
  }

  return {
    file: path.resolve(file),
    data
  }
}

async function generateDerivedData(
  imageBuffer,
  item,
  force
) {
  const result = {}

  const imageInfo =
    await validateUhdBuffer(
      imageBuffer
    )

  if (
    !imageInfo.valid
  ) {
    throw new Error(
      `Invalid UHD image dimensions: ${imageInfo.width}x${imageInfo.height}`
    )
  }

  if (
    force ||
    !isValidBase64(
      item.base64
    )
  ) {
    result.base64 =
      await getBase64(
        imageBuffer
      )
  }

  if (
    force ||
    !isValidColor(
      item.color
    )
  ) {
    result.color =
      await getMainColors(
        imageBuffer
      )
  }

  if (
    force ||
    !validateHistogram(
      item.colorHistogram
    )
  ) {
    result.colorHistogram =
      await getColorHistogram(
        imageInfo.image
      )
  }

  if (
    force ||
    Number(item.width) !==
      imageInfo.width
  ) {
    result.width =
      imageInfo.width
  }

  if (
    force ||
    Number(item.height) !==
      imageInfo.height
  ) {
    result.height =
      imageInfo.height
  }

  return result
}

async function generatePreview(
  imageBuffer,
  previewFile
) {
  const source =
    await Jimp.read(
      imageBuffer
    )

  const qualities = [
    82,
    78,
    75,
    72,
    70
  ]

  for (
    const quality of qualities
  ) {
    const image =
      source
        .clone()
        .resize(1600, 900)
        .quality(quality)

    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      )

    log(
      `Preview attempt: 1600x900 quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`
    )

    if (
      buffer.length <=
      PREVIEW_MAX_SIZE
    ) {
      fs.mkdirSync(
        path.dirname(
          previewFile
        ),
        {
          recursive: true
        }
      )

      fs.writeFileSync(
        previewFile,
        buffer
      )

      return
    }
  }

  for (
    const quality of [
      78,
      75,
      72,
      70
    ]
  ) {
    const image =
      source
        .clone()
        .resize(1280, 720)
        .quality(quality)

    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      )

    log(
      `Preview fallback: 1280x720 quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`
    )

    if (
      buffer.length <=
        PREVIEW_MAX_SIZE ||
      quality === 70
    ) {
      fs.mkdirSync(
        path.dirname(
          previewFile
        ),
        {
          recursive: true
        }
      )

      fs.writeFileSync(
        previewFile,
        buffer
      )

      return
    }
  }

  throw new Error(
    'Failed to generate preview'
  )
}

async function getExistingImageBuffer(
  item,
  date
) {
  const uhdFile =
    buildUhdFile(
      date
    )

  const localUhd =
    await loadImageFromFile(
      uhdFile
    )

  if (localUhd) {
    return {
      ...localUhd,
      file: uhdFile
    }
  }

  return null
}

async function obtainUhd(
  source,
  date
) {
  const uhdFile =
    buildUhdFile(
      date
    )

  const existing =
    await loadImageFromFile(
      uhdFile
    )

  if (existing) {
    return {
      ...existing,
      buffer:
        existing.buffer,
      file: uhdFile,
      sourceUrl:
        buildOfficialUhdUrl(
          source.urlbase
        ),
      downloaded: false
    }
  }

  const officialUrl =
    buildOfficialUhdUrl(
      source.urlbase
    )

  if (!officialUrl) {
    throw new Error(
      'Official UHD URL cannot be constructed.'
    )
  }

  const buffer =
    await downloadImage(
      officialUrl
    )

  const validated =
    await validateUhdBuffer(
      buffer
    )

  if (!validated.valid) {
    throw new Error(
      `Official UHD image is not large enough: ${validated.width}x${validated.height}`
    )
  }

  fs.mkdirSync(
    path.dirname(uhdFile),
    {
      recursive: true
    }
  )

  fs.writeFileSync(
    uhdFile,
    buffer
  )

  return {
    ...validated,
    buffer,
    file: uhdFile,
    sourceUrl: officialUrl,
    downloaded: true
  }
}

async function repairExistingItem(
  item,
  source,
  date,
  options
) {
  let changed = false

  const forceDerived =
    options.forceDerived === true

  const officialUhdUrl =
    buildOfficialUhdUrl(
      source.urlbase
    )

  if (
    source.title &&
    item.title !== source.title
  ) {
    item.title =
      source.title
    changed = true
  }

  if (
    source.copyright &&
    item.description !==
      source.copyright
  ) {
    item.description =
      source.copyright
    changed = true
  }

  if (
    source.copyright &&
    item.copyright !==
      source.copyright
  ) {
    item.copyright =
      source.copyright
    changed = true
  }

  if (
    source.copyrightLink &&
    item.copyrightLink !==
      source.copyrightLink
  ) {
    item.copyrightLink =
      source.copyrightLink
    changed = true
  }

  if (
    officialUhdUrl &&
    !isValidSourceImage(
      item.sourceImage
    )
  ) {
    item.sourceImage =
      officialUhdUrl

    changed = true
  } else if (
    officialUhdUrl &&
    item.sourceImage !==
      officialUhdUrl
  ) {
    item.sourceImage =
      officialUhdUrl

    changed = true
  }

  const uhd =
    await obtainUhd(
      source,
      date
    )

  if (
    uhd.downloaded
  ) {
    log(
      `UHD added: ${date} (${uhd.width}x${uhd.height})`
    )
  }

  const derived =
    await generateDerivedData(
      uhd.buffer,
      item,
      forceDerived
    )

  for (
    const [key, value] of Object.entries(
      derived
    )
  ) {
    if (
      JSON.stringify(item[key]) !==
      JSON.stringify(value)
    ) {
      item[key] = value
      changed = true
    }
  }

  const previewFile =
    path.join(
      'preview',
      buildRelativePath(
        '',
        date
      ) || ''
    )

  const parsed =
    parseDate(date)

  const actualPreviewFile =
    path.join(
      'preview',
      parsed.year,
      parsed.month,
      `${date}.jpg`
    )

  if (
    !fs.existsSync(
      actualPreviewFile
    )
  ) {
    await generatePreview(
      uhd.buffer,
      actualPreviewFile
    )

    log(
      `Preview generated: ${date}`
    )
  }

  const previewUrl =
    buildPreviewUrl(
      date
    )

  if (
    previewUrl &&
    item.preview !==
      previewUrl
  ) {
    item.preview =
      previewUrl
    changed = true
  }

  /*
   * 这里暂时不要切换 image。
   *
   * repair 阶段只保证对应 UHD 已经存在。
   * 真正切换到 IMAGE_BASE_URL 由 switch-image-url 完成。
   */
  if (
    options.switchImage === true
  ) {
    const imageUrl =
      buildImageUrl(
        date
      )

    if (
      imageUrl &&
      item.image !==
        imageUrl
    ) {
      item.image =
        imageUrl
      changed = true
    }
  }

  return {
    changed,
    uhd
  }
}

async function createMissingItem(
  source,
  date,
  options
) {
  const parsed =
    parseDate(date)

  if (!parsed) {
    throw new Error(
      `Invalid source date: ${date}`
    )
  }

  const uhd =
    await obtainUhd(
      source,
      date
    )

  const base64 =
    await getBase64(
      uhd.buffer
    )

  const color =
    await getMainColors(
      uhd.buffer
    )

  const colorHistogram =
    await getColorHistogram(
      uhd.image
    )

  const previewFile =
    path.join(
      'preview',
      parsed.year,
      parsed.month,
      `${date}.jpg`
    )

  if (
    !fs.existsSync(
      previewFile
    )
  ) {
    await generatePreview(
      uhd.buffer,
      previewFile
    )
  }

  const officialUhdUrl =
    buildOfficialUhdUrl(
      source.urlbase
    )

  const item = {
    date,

    title:
      source.title || '',

    description:
      source.copyright || '',

    copyright:
      source.copyright || '',

    copyrightLink:
      source.copyrightLink || null,

    image:
      options.switchImage
        ? buildImageUrl(date)
        : '',

    preview:
      buildPreviewUrl(date),

    sourceImage:
      officialUhdUrl,

    base64,

    color,

    colorHistogram,

    width:
      uhd.width,

    height:
      uhd.height,

    /*
     * 历史来源没有这些字段时不伪造。
     */
    id: null,

    startDate: null,

    fullStartDate: null,

    endDate: null
  }

  return {
    item,
    uhd
  }
}

function updateMonthFile(
  fileData,
  file,
  data
) {
  data.items.sort(
    (a, b) =>
      String(a.date).localeCompare(
        String(b.date)
      )
  )

  data.updatedAt =
    new Date().toISOString()

  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  )

  fs.writeFileSync(
    file,
    JSON.stringify(
      data,
      null,
      2
    ) + '\n',
    'utf8'
  )
}

function getYearsFromLocal(
  local
) {
  const years =
    new Set()

  for (
    const file of local.files
  ) {
    const match =
      /data[\\/](\d{4})[\\/]\d{2}\.json$/.exec(
        file
      )

    if (match) {
      years.add(
        match[1]
      )
    }
  }

  return Array.from(
    years
  ).sort()
}

async function getTargetYears(
  local
) {
  if (
    /^\d{4}$/.test(YEAR)
  ) {
    return [YEAR]
  }

  return getYearsFromLocal(
    local
  )
}

function reportItem(
  date,
  source,
  item
) {
  const missing =
    getMissingFields(
      item
    )

  if (
    missing.length === 0
  ) {
    return
  }

  const fieldNames = {
    date: '日期',
    title: '标题',
    description: '描述',
    copyright: '版权信息',
    copyrightLink: '版权链接',
    image: '高清图片地址',
    preview: '预览图片地址',
    sourceImage: '官方 UHD 图片地址',
    base64: 'Base64 缩略图',
    color: '主色调',
    colorHistogram: '颜色直方图',
    width: '图片宽度',
    height: '图片高度'
  }

  const readableFields =
    missing.map(
      field =>
        fieldNames[field] ||
        field
    )

  console.log(
    `[检查] ${date} 数据不完整：${readableFields.join('、')}`
  )

  if (
    source
  ) {
    const official =
      buildOfficialUhdUrl(
        source.urlbase
      )

    if (
      official &&
      item.sourceImage !==
        official
    ) {
      console.log(
        `        正确的官方 UHD 地址：${official}`
      )
    }
  }
}

async function runCheck(
  local,
  sources
) {
  const sourceMap =
    new Map()

  for (
    const source of sources
  ) {
    sourceMap.set(
      source.date,
      source
    )
  }

  /*
   * 历史资料源当前最大的日期。
   *
   * 例如：
   * 历史源最新只有 2026-10-07
   * 那么 2026-10-08 的 UHD 就属于：
   *
   * “待历史资料源收录”
   *
   * 而不是“孤立 UHD”。
   */
  const sourceDates =
    Array.from(
      sourceMap.keys()
    ).sort()

  const latestSourceDate =
    sourceDates.length > 0
      ? sourceDates[
          sourceDates.length - 1
        ]
      : null

  let total = 0
  let missingData = 0
  let incomplete = 0
  let invalidUhd = 0
  let missingUhd = 0

  const pendingSourceUhd = []
  const orphanUhd = []

  /*
   * 检查历史资料源中的每一天
   */
  for (
    const [date, source] of sourceMap
  ) {
    total++

    const localRecord =
      local.records.get(
        date
      )

    /*
     * bing-data 中完全没有这一天
     */
    if (!localRecord) {
      console.log(
        `[检查] 缺少数据记录：${date}`
      )

      missingData++

      /*
       * 没有 JSON 记录的情况下，
       * 这里先继续检查 UHD。
       */
    } else {
      const item =
        localRecord.item

      const missing =
        getMissingFields(
          item
        )

      if (
        missing.length > 0
      ) {
        incomplete++

        reportItem(
          date,
          source,
          item
        )
      }
    }

    /*
     * 检查 UHD 文件
     */
    const uhdFile =
      buildUhdFile(
        date
      )

    if (
      !fs.existsSync(
        uhdFile
      )
    ) {
      missingUhd++

      console.log(
        `[检查] 缺少 UHD 图片：${date}`
      )

      continue
    }

    const uhd =
      await loadImageFromFile(
        uhdFile
      )

    if (!uhd) {
      invalidUhd++

      console.log(
        `[检查] UHD 图片无效：${date}`
      )
    }
  }

  /*
   * 检查 bing-uhd 中存在、
   * 但历史资料源中没有的文件。
   */
  for (
    const file of collectUhdFiles()
  ) {
    const date =
      getDateFromUhdPath(
        file
      )

    if (!date) {
      continue
    }

    /*
     * 历史资料源已经有这个日期，
     * 正常，不是孤立文件。
     */
    if (
      sourceMap.has(date)
    ) {
      continue
    }

    /*
     * 如果日期比历史资料源最新日期还新，
     * 说明很可能是 Bing 每日任务已经提前下载，
     * 而第三方历史资料源还没有更新。
     */
    if (
      latestSourceDate &&
      date > latestSourceDate
    ) {
      pendingSourceUhd.push(
        date
      )

      continue
    }

    /*
     * 既不在历史源，也不是历史源之后的新日期，
     * 才真正算孤立 UHD。
     */
    orphanUhd.push(
      date
    )
  }

  /*
   * 排序，避免日志顺序不稳定。
   */
  pendingSourceUhd.sort()
  orphanUhd.sort()

  console.log('')
  console.log(
    '========== 历史数据检查 =========='
  )

  console.log(
    `历史资料源记录：${total}`
  )

  console.log(
    `缺少数据记录：${missingData}`
  )

  console.log(
    `数据字段不完整：${incomplete}`
  )

  console.log(
    `缺少 UHD 图片：${missingUhd}`
  )

  console.log(
    `UHD 图片无效：${invalidUhd}`
  )

  console.log(
    `待历史资料源收录的 UHD：${pendingSourceUhd.length}`
  )

  if (
    pendingSourceUhd.length > 0
  ) {
    console.log(
      `待收录日期：${pendingSourceUhd.join(', ')}`
    )
  }

  console.log(
    `真正孤立的 UHD：${orphanUhd.length}`
  )

  if (
    orphanUhd.length > 0
  ) {
    console.log(
      `孤立 UHD 日期：${orphanUhd.join(', ')}`
    )
  }

  if (
    latestSourceDate
  ) {
    console.log(
      `历史资料源最新日期：${latestSourceDate}`
    )
  }

  console.log(
    '==================================='
  )
}

async function runRepair(
  local,
  sources
) {
  const sourceMap =
    new Map()

  for (
    const source of sources
  ) {
    sourceMap.set(
      source.date,
      source
    )
  }

  const changedFiles =
    new Set()

  let processed = 0
  let repaired = 0
  let created = 0
  let downloaded = 0

  const entries =
    Array.from(
      sourceMap.entries()
    ).sort(
      (a, b) =>
        a[0].localeCompare(
          b[0]
        )
    )

  for (
    const [date, source] of entries
  ) {
    if (
      MAX_IMAGES > 0 &&
      processed >= MAX_IMAGES
    ) {
      break
    }

    processed++

    const localRecord =
      local.records.get(
        date
      )

    try {
      if (
        localRecord
      ) {
        const result =
          await repairExistingItem(
            localRecord.item,
            source,
            date,
            {
              forceDerived:
                false,
              switchImage:
                false
            }
          )

        if (
          result.uhd.downloaded
        ) {
          downloaded++
        }

        if (
          result.changed
        ) {
          repaired++

          changedFiles.add(
            localRecord.file
          )
        }

        console.log(
          `[REPAIR] ${date} completed`
        )

        continue
      }

      /*
       * data 中没有记录：
       * 只要官方 UHD 能下载，就完整创建一条记录。
       */
      const {
        item,
        uhd
      } =
        await createMissingItem(
          source,
          date,
          {
            switchImage: false
          }
        )

      const {
        file,
        data
      } =
        ensureMonthData(
          local.fileData,
          date
        )

      data.items.push(
        item
      )

      local.records.set(
        date,
        {
          item,
          file
        }
      )

      changedFiles.add(
        file
      )

      created++

      if (
        uhd.downloaded
      ) {
        downloaded++
      }

      console.log(
        `[REPAIR] DATA CREATED: ${date}`
      )
    } catch (error) {
      console.error(
        `[REPAIR] FAILED: ${date}: ${error.message}`
      )
    }
  }

  for (
    const file of changedFiles
  ) {
    const data =
      local.fileData.get(
        file
      )

    if (!data) continue

    updateMonthFile(
      local.fileData,
      file,
      data
    )
  }

  if (
    changedFiles.size > 0
  ) {
    buildIndex()
  }

  console.log('')
  console.log(
    '========== HISTORY REPAIR =========='
  )
  console.log(
    `Processed: ${processed}`
  )
  console.log(
    `Repaired records: ${repaired}`
  )
  console.log(
    `Created records: ${created}`
  )
  console.log(
    `Downloaded UHD: ${downloaded}`
  )
  console.log(
    `Changed JSON files: ${changedFiles.size}`
  )
  console.log(
    '===================================='
  )
}

async function runSwitchImageUrl(
  local,
  sources
) {
  const sourceMap =
    new Map()

  for (
    const source of sources
  ) {
    sourceMap.set(
      source.date,
      source
    )
  }

  const changedFiles =
    new Set()

  let switched = 0
  let skipped = 0

  for (
    const [
      date,
      localRecord
    ] of local.records
  ) {
    const source =
      sourceMap.get(
        date
      )

    if (!source) {
      skipped++

      console.log(
        `[SWITCH] SKIP ${date}: source metadata missing`
      )

      continue
    }

    const uhdFile =
      buildUhdFile(
        date
      )

    const uhd =
      await loadImageFromFile(
        uhdFile
      )

    if (!uhd) {
      skipped++

      console.log(
        `[SWITCH] SKIP ${date}: UHD missing or invalid`
      )

      continue
    }

    const newImageUrl =
      buildImageUrl(
        date
      )

    if (!newImageUrl) {
      throw new Error(
        'IMAGE_BASE_URL is not configured'
      )
    }

    if (
      localRecord.item.image !==
      newImageUrl
    ) {
      localRecord.item.image =
        newImageUrl

      changedFiles.add(
        localRecord.file
      )

      switched++
    }
  }

  for (
    const file of changedFiles
  ) {
    const data =
      local.fileData.get(
        file
      )

    if (!data) continue

    updateMonthFile(
      local.fileData,
      file,
      data
    )
  }

  if (
    changedFiles.size > 0
  ) {
    buildIndex()
  }

  console.log('')
  console.log(
    '======= SWITCH IMAGE URL ======='
  )
  console.log(
    `Switched: ${switched}`
  )
  console.log(
    `Skipped: ${skipped}`
  )
  console.log(
    `Changed JSON files: ${changedFiles.size}`
  )
  console.log(
    '================================'
  )
}

async function main() {
  if (
    !PREVIEW_BASE_URL
  ) {
    fail(
      'PREVIEW_BASE_URL is not configured'
    )
  }

  if (
    !HISTORY_SOURCE_BASE_URL
  ) {
    fail(
      'HISTORY_SOURCE_BASE_URL is not configured'
    )
  }

  if (
    !fs.existsSync(
      UHD_ROOT
    )
  ) {
    fail(
      `UHD repository not found: ${UHD_ROOT}`
    )
  }

  log(
    `MODE=${MODE}`
  )

  log(
    `YEAR=${YEAR}`
  )

  log(
    `UHD_ROOT=${UHD_ROOT}`
  )

  const local =
    loadLocalData()

  const years =
    await getTargetYears(
      local
    )

  if (
    years.length === 0
  ) {
    fail(
      'No target years found.'
    )
  }

  log(
    `Target years: ${years.join(', ')}`
  )

  const sources = []

  for (
    const year of years
  ) {
    const yearRecords =
      await loadHistorySource(
        year
      )

    sources.push(
      ...yearRecords
    )
  }

  if (
    MODE === 'check'
  ) {
    await runCheck(
      local,
      sources
    )

    return
  }

  if (
    MODE === 'repair'
  ) {
    await runRepair(
      local,
      sources
    )

    return
  }

  if (
    MODE === 'switch-image-url'
  ) {
    if (
      !IMAGE_BASE_URL
    ) {
      fail(
        'IMAGE_BASE_URL is not configured'
      )
    }

    await runSwitchImageUrl(
      local,
      sources
    )

    return
  }

  fail(
    `Unknown MODE: ${MODE}`
  )
}

main().catch(error => {
  console.error(
    '========================================'
  )

  console.error(
    'History repair failed.'
  )

  console.error(error)

  console.error(
    '========================================'
  )

  process.exitCode = 1
})
