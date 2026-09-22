const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const Jimp = require('jimp')
const Vibrant = require('node-vibrant')
const { getColorHistogram, isValidColorHistogram } = require('./color-histogram')

// ============================================================
// 基础配置
// ============================================================

const SOURCE_API =
  'https://bing.npanuhin.me/CN-zh.json'

const IMAGE_ROOT = 'images'
const PREVIEW_ROOT = 'preview'
const DATA_ROOT = 'data'

const IMAGE_MIN_SIZE = 50 * 1024
const PREVIEW_MIN_SIZE = 1024
const PREVIEW_MAX_SIZE = 800 * 1024

const REQUEST_TIMEOUT = 60 * 1000
const MAX_RETRIES = 3
const REQUEST_INTERVAL = 500

const MAX_DAYS = 90

const START_DATE_INPUT =
  (process.env.START_DATE || '').trim()

const END_DATE_INPUT =
  (process.env.END_DATE || '').trim()

const ASSET_BASE_URL = (
  process.env.ASSET_BASE_URL ||
  'https://bing-data.伴随.cn'
).replace(/\/+$/, '')

// ============================================================
// 通用工具
// ============================================================

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, {
    recursive: true
  })
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

function isValidFile(filePath, minSize = 1) {
  if (!fileExists(filePath)) {
    return false
  }

  try {
    const stat = fs.statSync(filePath)

    return (
      stat.isFile() &&
      stat.size >= minSize
    )
  } catch {
    return false
  }
}

function normalizeDate(value) {
  if (!value) {
    return null
  }

  const text = String(value).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  if (/^\d{8}$/.test(text)) {
    return [
      text.substring(0, 4),
      text.substring(4, 6),
      text.substring(6, 8)
    ].join('-')
  }

  return null
}

function isValidDate(value) {
  const date = normalizeDate(value)

  if (!date) {
    return false
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)

  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const parsed = new Date(
    Date.UTC(year, month - 1, day)
  )

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function dateToUtc(date) {
  return new Date(`${date}T00:00:00.000Z`)
}

function formatDate(date) {
  return date.toISOString().substring(0, 10)
}

function addDays(date, days) {
  const result = dateToUtc(date)

  result.setUTCDate(
    result.getUTCDate() + days
  )

  return formatDate(result)
}

function daysBetween(startDate, endDate) {
  const start = dateToUtc(startDate).getTime()
  const end = dateToUtc(endDate).getTime()

  return Math.floor(
    (end - start) / (24 * 60 * 60 * 1000)
  ) + 1
}

function minDate(date1, date2) {
  return date1 <= date2 ? date1 : date2
}

function maxDate(date1, date2) {
  return date1 >= date2 ? date1 : date2
}

function getCurrentShanghaiDate() {
  const formatter = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  )

  return formatter.format(new Date())
}

function buildAssetUrl(filePath) {
  return (
    ASSET_BASE_URL +
    '/' +
    filePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
  )
}

function getImageFilePath(date) {
  const year = date.substring(0, 4)
  const month = date.substring(5, 7)

  return path.join(
    IMAGE_ROOT,
    year,
    month,
    `${date}.jpg`
  )
}

function getPreviewFilePath(date) {
  const year = date.substring(0, 4)
  const month = date.substring(5, 7)

  return path.join(
    PREVIEW_ROOT,
    year,
    month,
    `${date}.jpg`
  )
}

function getDataFilePath(date) {
  const year = date.substring(0, 4)
  const month = date.substring(5, 7)

  return path.join(
    DATA_ROOT,
    year,
    `${month}.json`
  )
}

// ============================================================
// 网络请求
// ============================================================

function requestBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(
        new Error('Too many redirects')
      )

      return
    }

    const client = url.startsWith('https://')
      ? https
      : http

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 BingWallpaperBackfill/1.0',
          Accept: '*/*'
        }
      },
      response => {
        const statusCode =
          response.statusCode || 0

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          response.resume()

          const redirectUrl =
            new URL(
              response.headers.location,
              url
            ).toString()

          requestBuffer(
            redirectUrl,
            redirectCount + 1
          )
            .then(resolve)
            .catch(reject)

          return
        }

        if (statusCode !== 200) {
          response.resume()

          reject(
            new Error(
              `HTTP ${statusCode}: ${url}`
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
      REQUEST_TIMEOUT,
      () => {
        request.destroy(
          new Error(
            `Request timeout: ${url}`
          )
        )
      }
    )

    request.on('error', reject)
  })
}

async function downloadWithRetry(url) {
  let lastError = null

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      console.log(
        `Downloading image, attempt ${attempt}/${MAX_RETRIES}: ${url}`
      )

      const buffer =
        await requestBuffer(url)

      if (
        !Buffer.isBuffer(buffer) ||
        buffer.length < IMAGE_MIN_SIZE
      ) {
        throw new Error(
          `Downloaded image is too small: ${buffer.length} bytes`
        )
      }

      return buffer
    } catch (error) {
      lastError = error

      console.warn(
        `Download failed on attempt ${attempt}: ${error.message}`
      )

      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt)
      }
    }
  }

  throw lastError ||
    new Error('Download failed')
}

// ============================================================
// 图片处理
// ============================================================

async function readImageSafely(filePath) {
  if (
    !isValidFile(
      filePath,
      IMAGE_MIN_SIZE
    )
  ) {
    return null
  }

  try {
    return await Jimp.read(filePath)
  } catch (error) {
    console.warn(
      `Failed to read image ${filePath}: ${error.message}`
    )

    return null
  }
}

async function saveImageBuffer(
  buffer,
  filePath
) {
  ensureDirectory(
    path.dirname(filePath)
  )

  fs.writeFileSync(
    filePath,
    buffer
  )

  try {
    const image =
      await Jimp.read(filePath)

    if (
      image.bitmap.width <= 0 ||
      image.bitmap.height <= 0
    ) {
      throw new Error(
        'Image width or height is invalid'
      )
    }

    return image
  } catch (error) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // 忽略删除失败
    }

    throw new Error(
      `Invalid downloaded image: ${error.message}`
    )
  }
}

function getPaletteValue(palette, key) {
  const color = palette[key]

  if (
    !color ||
    !Array.isArray(color._rgb) ||
    color._rgb.length < 3
  ) {
    return null
  }

  const rgb = color._rgb

  const toHex = value => {
    return Math.max(
      0,
      Math.min(
        255,
        Math.round(value)
      )
    )
      .toString(16)
      .padStart(2, '0')
  }

  return (
    '#' +
    toHex(rgb[0]) +
    toHex(rgb[1]) +
    toHex(rgb[2])
  )
}

async function getMainColors(filePath) {
  try {
    const palette =
      await Vibrant.from(filePath).getPalette()

    const result = {}

    const keys = [
      'Vibrant',
      'DarkVibrant',
      'LightVibrant',
      'Muted',
      'DarkMuted',
      'LightMuted'
    ]

    for (const key of keys) {
      const value =
        getPaletteValue(
          palette,
          key
        )

      if (value) {
        result[key] = value
      }
    }

    return result
  } catch (error) {
    console.warn(
      `Failed to extract colors: ${error.message}`
    )

    return {}
  }
}

async function getBase64(image) {
  const smallImage =
    image.clone()

  smallImage.resize(
    16,
    9
  )

  smallImage.quality(90)

  return await smallImage.getBase64Async(
    Jimp.MIME_JPEG
  )
}

async function writePreview(
  image,
  previewFile
) {
  ensureDirectory(
    path.dirname(previewFile)
  )

  const sizes = [
    {
      width: 1600,
      height: 900,
      qualities: [
        82,
        78,
        75,
        72,
        70
      ]
    },
    {
      width: 1280,
      height: 720,
      qualities: [
        78,
        75,
        72,
        70
      ]
    }
  ]

  for (const size of sizes) {
    for (const quality of size.qualities) {
      const preview =
        image.clone()

      preview.contain(
        size.width,
        size.height
      )

      preview.quality(quality)

      const buffer =
        await preview.getBufferAsync(
          Jimp.MIME_JPEG
        )

      if (
        buffer.length <= PREVIEW_MAX_SIZE
      ) {
        fs.writeFileSync(
          previewFile,
          buffer
        )

        return
      }
    }
  }

  const fallback =
    image.clone()

  fallback.contain(
    1280,
    720
  )

  fallback.quality(65)

  const fallbackBuffer =
    await fallback.getBufferAsync(
      Jimp.MIME_JPEG
    )

  fs.writeFileSync(
    previewFile,
    fallbackBuffer
  )
}

async function isValidPreview(previewFile) {
  if (
    !isValidFile(
      previewFile,
      PREVIEW_MIN_SIZE
    )
  ) {
    return false
  }

  try {
    const image =
      await Jimp.read(previewFile)

    return (
      image.bitmap.width > 0 &&
      image.bitmap.height > 0
    )
  } catch {
    return false
  }
}

// ============================================================
// JSON 数据处理
// ============================================================

function loadMonthData(dataFile) {
  if (!fileExists(dataFile)) {
    return {
      version: 1,
      year: Number(
        path.basename(
          path.dirname(dataFile)
        )
      ),
      month: Number(
        path.basename(
          dataFile,
          '.json'
        )
      ),
      updatedAt: null,
      items: []
    }
  }

  try {
    const data =
      JSON.parse(
        fs.readFileSync(
          dataFile,
          'utf8'
        )
      )

    if (!Array.isArray(data.items)) {
      data.items = []
    }

    return data
  } catch (error) {
    throw new Error(
      `Failed to parse ${dataFile}: ${error.message}`
    )
  }
}

function sortItems(items) {
  return items.sort((a, b) => {
    return String(b.date || '')
      .localeCompare(
        String(a.date || '')
      )
  })
}

function findItem(items, date) {
  return items.find(
    item => item && item.date === date
  )
}

function hasValidColor(color) {
  if (
    !color ||
    typeof color !== 'object' ||
    Array.isArray(color)
  ) {
    return false
  }

  return Object.keys(color).some(
    key => Boolean(color[key])
  )
}

function hasValidBase64(base64) {
  return (
    typeof base64 === 'string' &&
    base64.startsWith('data:image/')
  )
}

function hasValidDimensions(item) {
  return (
    Number.isFinite(Number(item.width)) &&
    Number.isFinite(Number(item.height)) &&
    Number(item.width) > 0 &&
    Number(item.height) > 0
  )
}

function hasValidJsonItem(
  item,
  date
) {
  if (!item) {
    return false
  }

  if (item.date !== date) {
    return false
  }

  const requiredStringFields = [
    'image',
    'preview',
    'sourceImage',
    'id',
    'startDate',
    'fullStartDate',
    'endDate'
  ]

  for (
    const field of requiredStringFields
  ) {
    if (
      typeof item[field] !== 'string' ||
      !item[field].trim()
    ) {
      return false
    }
  }

  if (!hasValidBase64(item.base64)) {
    return false
  }

  if (!hasValidColor(item.color)) {
    return false
  }

  if (!hasValidDimensions(item)) {
    return false
  }

  const expectedImage =
    buildAssetUrl(
      getImageFilePath(date)
    )

  const expectedPreview =
    buildAssetUrl(
      getPreviewFilePath(date)
    )

  if (item.image !== expectedImage) {
    return false
  }

  if (item.preview !== expectedPreview) {
    return false
  }

  return true
}

function createItem({
  source,
  date,
  imageUrl,
  previewUrl,
  base64,
  color,
  width,
  height
}) {
  return {
    date,
    title:
      source.title ||
      source.name ||
      '',
    description:
      source.description ||
      source.copyright ||
      '',
    copyright:
      source.copyright ||
      source.description ||
      '',
    copyrightLink:
      source.copyrightLink ||
      source.copyrightlink ||
      '',
    image: imageUrl,
    preview: previewUrl,
    sourceImage:
      source.url ||
      source.image ||
      source.bing_url ||
      '',
    base64,
    color,
    width,
    height,
    id:
      source.id ||
      source.imageId ||
      '',
    startDate:
      source.startDate ||
      '',
    fullStartDate:
      source.fullStartDate ||
      '',
    endDate:
      source.endDate ||
      ''
  }
}

function mergeItem(existing, generated) {
  if (!existing) {
    return generated
  }

  return {
    ...existing,
    ...generated,

    title:
      generated.title ||
      existing.title ||
      '',

    description:
      generated.description ||
      existing.description ||
      '',

    copyright:
      generated.copyright ||
      existing.copyright ||
      '',

    copyrightLink:
      generated.copyrightLink ||
      existing.copyrightLink ||
      '',

    sourceImage:
      generated.sourceImage ||
      existing.sourceImage ||
      '',

    id:
      generated.id ||
      existing.id ||
      '',

    startDate:
      generated.startDate ||
      existing.startDate ||
      '',

    fullStartDate:
      generated.fullStartDate ||
      existing.fullStartDate ||
      '',

    endDate:
      generated.endDate ||
      existing.endDate ||
      ''
  }
}

function itemsEqual(item1, item2) {
  return (
    JSON.stringify(item1) ===
    JSON.stringify(item2)
  )
}

function saveMonthData(
  dataFile,
  data,
  previousData
) {
  const newItems =
    sortItems(data.items)

  const oldItems =
    sortItems(
      Array.isArray(previousData.items)
        ? previousData.items
        : []
    )

  const oldComparable = {
    ...previousData,
    items: oldItems
  }

  const newComparable = {
    ...data,
    items: newItems
  }

  delete oldComparable.updatedAt
  delete newComparable.updatedAt

  if (
    JSON.stringify(oldComparable) ===
    JSON.stringify(newComparable)
  ) {
    return false
  }

  data.items = newItems
  data.updatedAt =
    new Date().toISOString()

  ensureDirectory(
    path.dirname(dataFile)
  )

  fs.writeFileSync(
    dataFile,
    JSON.stringify(
      data,
      null,
      2
    ) + '\n',
    'utf8'
  )

  return true
}

// ============================================================
// 日期范围
// ============================================================

function getSourceDate(source) {
  return normalizeDate(
    source.date ||
    source.startDate ||
    source.fullStartDate ||
    source.endDate
  )
}

function getSourceLatestDate(sourceItems) {
  const dates =
    sourceItems
      .map(getSourceDate)
      .filter(Boolean)
      .filter(isValidDate)
      .sort()

  if (dates.length === 0) {
    throw new Error(
      'No valid date found in source data'
    )
  }

  return dates[dates.length - 1]
}

function getDateRange(sourceItems) {
  const sourceLatestDate =
    getSourceLatestDate(sourceItems)

  const currentDate =
    getCurrentShanghaiDate()

  const latestDate =
    minDate(
      sourceLatestDate,
      currentDate
    )

  let startDate =
    START_DATE_INPUT || ''

  let endDate =
    END_DATE_INPUT || ''

  if (startDate && !isValidDate(startDate)) {
    throw new Error(
      `Invalid START_DATE: ${startDate}. Expected YYYY-MM-DD.`
    )
  }

  if (endDate && !isValidDate(endDate)) {
    throw new Error(
      `Invalid END_DATE: ${endDate}. Expected YYYY-MM-DD.`
    )
  }

  if (!startDate && !endDate) {
    endDate = latestDate
    startDate = addDays(
      endDate,
      -(MAX_DAYS - 1)
    )
  } else if (startDate && !endDate) {
    endDate = minDate(
      addDays(
        startDate,
        MAX_DAYS - 1
      ),
      latestDate
    )
  } else if (!startDate && endDate) {
    startDate = addDays(
      endDate,
      -(MAX_DAYS - 1)
    )
  }

  if (startDate > endDate) {
    throw new Error(
      `Invalid date range: ${startDate} > ${endDate}`
    )
  }

  const totalDays =
    daysBetween(
      startDate,
      endDate
    )

  if (totalDays > MAX_DAYS) {
    throw new Error(
      `Date range cannot exceed ${MAX_DAYS} days. Actual: ${totalDays}`
    )
  }

  return {
    startDate,
    endDate,
    totalDays,
    sourceLatestDate,
    currentDate
  }
}

// ============================================================
// 源数据
// ============================================================

async function loadSourceData() {
  const buffer =
    await downloadWithRetry(
      SOURCE_API
    )

  let data

  try {
    data =
      JSON.parse(
        buffer.toString('utf8')
      )
  } catch (error) {
    throw new Error(
      `Failed to parse source API JSON: ${error.message}`
    )
  }

  if (Array.isArray(data)) {
    return data
  }

  if (Array.isArray(data.items)) {
    return data.items
  }

  if (Array.isArray(data.images)) {
    return data.images
  }

  throw new Error(
    'Unsupported source data format'
  )
}

function filterSourceItems(
  sourceItems,
  startDate,
  endDate
) {
  const result = []

  for (const source of sourceItems) {
    if (!source || typeof source !== 'object') {
      continue
    }

    const date =
      getSourceDate(source)

    if (!date || !isValidDate(date)) {
      continue
    }

    if (
      date < startDate ||
      date > endDate
    ) {
      continue
    }

    result.push({
      ...source,
      date
    })
  }

  const uniqueMap = new Map()

  for (const item of result) {
    uniqueMap.set(
      item.date,
      item
    )
  }

  return Array.from(
    uniqueMap.values()
  ).sort((a, b) => {
    return a.date.localeCompare(b.date)
  })
}

// ============================================================
// 单条数据处理
// ============================================================

async function processItem(source) {
  const date = source.date

  const imageFile =
    getImageFilePath(date)

  const previewFile =
    getPreviewFilePath(date)

  const dataFile =
    getDataFilePath(date)

  const imageUrl =
    buildAssetUrl(imageFile)

  const previewUrl =
    buildAssetUrl(previewFile)

  const data =
    loadMonthData(dataFile)

  const previousData =
    JSON.parse(
      JSON.stringify(data)
    )

  const existing =
    findItem(
      data.items,
      date
    )

  let image
  let imageDownloaded = false
  let imageRepaired = false
  let previewRepaired = false
  let jsonRepaired = false

  // ----------------------------------------------------------
  // 检查并准备原图
  // ----------------------------------------------------------

  image =
    await readImageSafely(
      imageFile
    )

  if (!image) {
    const sourceImageUrl =
      source.url ||
      source.image ||
      source.bing_url

    if (!sourceImageUrl) {
      throw new Error(
        `No source image URL for ${date}`
      )
    }

    const buffer =
      await downloadWithRetry(
        sourceImageUrl
      )

    image =
      await saveImageBuffer(
        buffer,
        imageFile
      )

    imageDownloaded = true
    imageRepaired = true

    console.log(
      `[${date}] Original image downloaded`
    )
  }

  const width =
    image.bitmap.width

  const height =
    image.bitmap.height

  // ----------------------------------------------------------
  // 检查并准备预览图
  // ----------------------------------------------------------

  const previewValid =
    await isValidPreview(
      previewFile
    )

  if (!previewValid) {
    await writePreview(
      image,
      previewFile
    )

    previewRepaired = true

    console.log(
      `[${date}] Preview image generated`
    )
  }

  // ----------------------------------------------------------
  // 补齐 Base64
  // ----------------------------------------------------------

  let base64 =
    existing &&
    hasValidBase64(existing.base64)
      ? existing.base64
      : null

  if (!base64) {
    base64 =
      await getBase64(image)

    jsonRepaired = true

    console.log(
      `[${date}] Base64 generated`
    )
  }

  // ----------------------------------------------------------
  // 补齐主色调
  // ----------------------------------------------------------

  let color =
    existing &&
    hasValidColor(existing.color)
      ? existing.color
      : null

  if (!color) {
    color =
      await getMainColors(
        imageFile
      )

    jsonRepaired = true

    console.log(
      `[${date}] Colors generated`
    )
  }

  // ----------------------------------------------------------
  // 补齐颜色直方图
  // ----------------------------------------------------------

  let colorHistogram =
    existing &&
    isValidColorHistogram(
      existing.colorHistogram
    )
      ? existing.colorHistogram
      : null

  if (!colorHistogram) {
    colorHistogram =
      await getColorHistogram(
        imageFile
      )

    jsonRepaired = true

    console.log(
      `[${date}] Color histogram generated`
    )
  }

  // ----------------------------------------------------------
  // 生成 JSON 数据
  // ----------------------------------------------------------

  const generated =
    createItem({
      source,
      date,
      imageUrl,
      previewUrl,
      base64,
      color,
      colorHistogram,
      width,
      height
    })

  const finalItem =
    mergeItem(
      existing,
      generated
    )

  const complete =
    hasValidJsonItem(
      existing,
      date
    ) &&
    isValidFile(
      imageFile,
      IMAGE_MIN_SIZE
    ) &&
    previewValid

  if (
    complete &&
    !imageDownloaded &&
    !imageRepaired &&
    !previewRepaired &&
    !jsonRepaired
  ) {
    console.log(
      `[${date}] Complete, skipped`
    )

    return {
      status: 'skipped',
      date
    }
  }

  if (
    existing &&
    itemsEqual(
      existing,
      finalItem
    ) &&
    !imageRepaired &&
    !previewRepaired
  ) {
    console.log(
      `[${date}] No JSON changes required`
    )

    return {
      status: 'skipped',
      date
    }
  }

  const itemIndex =
    data.items.findIndex(
      item =>
        item &&
        item.date === date
    )

  if (itemIndex >= 0) {
    data.items[itemIndex] =
      finalItem
  } else {
    data.items.push(finalItem)
  }

  const changed =
    saveMonthData(
      dataFile,
      data,
      previousData
    )

  if (!changed) {
    return {
      status: 'skipped',
      date
    }
  }

  if (existing) {
    console.log(
      `[${date}] Existing item repaired`
    )

    return {
      status: 'updated',
      date
    }
  }

  console.log(
    `[${date}] New item added`
  )

  return {
    status: 'added',
    date
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(
    '========================================'
  )
  console.log(
    'Bing Wallpaper History Backfill'
  )
  console.log(
    '========================================'
  )

  console.log(
    `ASSET_BASE_URL: ${ASSET_BASE_URL}`
  )

  console.log(
    `START_DATE input: ${START_DATE_INPUT || '(empty)'}`
  )

  console.log(
    `END_DATE input: ${END_DATE_INPUT || '(empty)'}`
  )

  console.log('')

  const sourceItems =
    await loadSourceData()

  console.log(
    `Source items: ${sourceItems.length}`
  )

  const range =
    getDateRange(
      sourceItems
    )

  console.log('')
  console.log(
    `Source latest date: ${range.sourceLatestDate}`
  )

  console.log(
    `Current Shanghai date: ${range.currentDate}`
  )

  console.log(
    `Resolved start date: ${range.startDate}`
  )

  console.log(
    `Resolved end date: ${range.endDate}`
  )

  console.log(
    `Total days: ${range.totalDays}`
  )

  const items =
    filterSourceItems(
      sourceItems,
      range.startDate,
      range.endDate
    )

  console.log('')
  console.log(
    `Matched source items: ${items.length}`
  )

  if (items.length === 0) {
    console.log(
      'No source items need to process.'
    )

    return
  }

  let added = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const item of items) {
    try {
      const result =
        await processItem(item)

      if (result.status === 'added') {
        added++
      } else if (
        result.status === 'updated'
      ) {
        updated++
      } else if (
        result.status === 'skipped'
      ) {
        skipped++
      }
    } catch (error) {
      failed++

      console.error(
        `[${item.date}] Failed: ${error.message}`
      )
    }

    await sleep(
      REQUEST_INTERVAL
    )
  }

  console.log('')
  console.log(
    '========================================'
  )
  console.log(
    'Backfill completed'
  )
  console.log(
    '========================================'
  )
  console.log(
    `Added: ${added}`
  )
  console.log(
    `Updated: ${updated}`
  )
  console.log(
    `Skipped: ${skipped}`
  )
  console.log(
    `Failed: ${failed}`
  )

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('')
  console.error(
    'Backfill failed:',
    error.message
  )

  process.exitCode = 1
})
