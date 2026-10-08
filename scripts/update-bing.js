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

if (!PREVIEW_BASE_URL) {
  throw new Error(
    'PREVIEW_BASE_URL is not configured'
  )
}

if (!IMAGE_BASE_URL) {
  throw new Error(
    'IMAGE_BASE_URL is not configured'
  )
}

const PREVIEW_MAX_SIZE = 800 * 1024

const MIN_UHD_WIDTH = 3000
const MIN_UHD_HEIGHT = 1600

const BING_API_URL =
  'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'

function log(message) {
  console.log(
    `[${new Date().toISOString()}] ${message}`
  )
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * 将 YYYYMMDD / YYYY-MM-DD 统一成 YYYY-MM-DD
 */
function normalizeDate(value) {
  if (!value) {
    return null
  }

  const text =
    String(value).trim()

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {
    return text
  }

  if (
    /^\d{8}$/.test(text)
  ) {
    return [
      text.slice(0, 4),
      text.slice(4, 6),
      text.slice(6, 8)
    ].join('-')
  }

  return null
}

/**
 * 构造：
 *
 * https://bing-uhd.伴随.cn/images/2026/10/2026-10-08.jpg
 *
 * 或：
 *
 * https://bing-data.伴随.cn/preview/2026/10/2026-10-08.jpg
 */
function buildAssetUrl(
  baseUrl,
  relativePath
) {
  return `${baseUrl}/${relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')}`
}

/**
 * 构造 Bing 官方 UHD 地址。
 *
 * Bing API 返回：
 *
 * urlbase:
 * /th?id=OHR.xxx_ZH-CN...
 *
 * 最终：
 *
 * https://www.bing.com/th?id=..._UHD.jpg
 */
function buildOfficialUhdUrl(urlbase) {
  if (!urlbase) {
    return null
  }

  let normalized =
    String(urlbase).trim()

  if (!normalized) {
    return null
  }

  /*
   * 有些情况下 urlbase 可能已经是完整 URL。
   */
  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://')
  ) {
    try {
      const parsed =
        new URL(normalized)

      return `${parsed.origin}${parsed.pathname}_UHD.jpg${parsed.search}`
    } catch {
      return null
    }
  }

  if (
    !normalized.startsWith('/')
  ) {
    normalized =
      `/${normalized}`
  }

  return `https://www.bing.com${normalized}_UHD.jpg`
}

/**
 * HTTP / HTTPS 下载。
 *
 * 支持：
 * - 302 / 301 跳转
 * - 超时
 * - 失败重试
 */
function requestBuffer(
  url,
  retry = 0
) {
  return new Promise(
    (resolve, reject) => {
      const client =
        url.startsWith('https://')
          ? https
          : http

      const request =
        client.get(
          url,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
              'Accept':
                'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
          },
          response => {
            /*
             * 跟随 HTTP 重定向。
             */
            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
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
                retry
              )
                .then(resolve)
                .catch(reject)

              return
            }

            if (
              response.statusCode !== 200
            ) {
              response.resume()

              reject(
                new Error(
                  `HTTP ${response.statusCode}: ${url}`
                )
              )

              return
            }

            const chunks = []

            response.on(
              'data',
              chunk => {
                chunks.push(chunk)
              }
            )

            response.on(
              'end',
              () => {
                resolve(
                  Buffer.concat(
                    chunks
                  )
                )
              }
            )

            response.on(
              'error',
              reject
            )
          }
        )

      request.setTimeout(
        30000,
        () => {
          request.destroy(
            new Error(
              `Request timeout: ${url}`
            )
          )
        }
      )

      request.on(
        'error',
        error => {
          if (retry < 3) {
            const nextRetry =
              retry + 1

            log(
              `Request failed, retry ${nextRetry}/3: ${error.message}`
            )

            sleep(
              2000 * nextRetry
            )
              .then(() =>
                requestBuffer(
                  url,
                  nextRetry
                )
              )
              .then(resolve)
              .catch(reject)

            return
          }

          reject(error)
        }
      )
    }
  )
}

/**
 * 下载并做最基础的文件大小检查。
 */
async function downloadImage(url) {
  log(
    `Downloading image: ${url}`
  )

  const buffer =
    await requestBuffer(url)

  if (
    !buffer ||
    buffer.length < 50 * 1024
  ) {
    throw new Error(
      `Image is too small: ${
        buffer
          ? buffer.length
          : 0
      } bytes`
    )
  }

  return buffer
}

/**
 * 验证 UHD 图片：
 *
 * 1. 必须能够被 Jimp 解码
 * 2. 宽度至少 3000
 * 3. 高度至少 1600
 */
async function validateUhdBuffer(
  buffer
) {
  const image =
    await Jimp.read(buffer)

  const width =
    image.bitmap.width

  const height =
    image.bitmap.height

  if (
    width < MIN_UHD_WIDTH ||
    height < MIN_UHD_HEIGHT
  ) {
    throw new Error(
      `Downloaded image is not UHD enough: ${width}x${height}`
    )
  }

  return {
    image,
    width,
    height
  }
}

function componentToHex(num) {
  const hex =
    Math.round(num)
      .toString(16)

  return hex.length === 1
    ? `0${hex}`
    : hex
}

function rgbToHex(rgb) {
  return `#${componentToHex(rgb[0])}${componentToHex(rgb[1])}${componentToHex(rgb[2])}`
}

/**
 * 从 UHD 原图计算主色。
 */
async function getMainColors(
  imageBuffer
) {
  const image =
    await Jimp.read(
      imageBuffer
    )

  const tempFile =
    path.join(
      process.env.RUNNER_TEMP ||
        '/tmp',
      'bing-color.jpg'
    )

  await image.writeAsync(
    tempFile
  )

  const palette =
    await new Promise(
      (resolve, reject) => {
        Vibrant
          .from(tempFile)
          .getPalette(
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

  Object.keys(
    palette || {}
  ).forEach(key => {
    const swatch =
      palette[key]

    if (
      swatch &&
      swatch.rgb
    ) {
      colors[key] =
        rgbToHex(
          swatch.rgb
        )
    }
  })

  return colors
}

/**
 * 生成 Base64 缩略图。
 *
 * 注意：
 * 这里仍然使用 UHD 原图生成，
 * 而不是 preview。
 */
async function getBase64(
  imageBuffer
) {
  const image =
    await Jimp.read(
      imageBuffer
    )

  image
    .resize(16, 9)
    .quality(90)

  return image.getBase64Async(
    Jimp.MIME_JPEG
  )
}

/**
 * 生成 preview。
 *
 * 目标：
 * - 优先 1600x900
 * - 最大 800KB
 * - 如果无法满足，则降到 1280x720
 *
 * 注意：
 * 最终必须真正写文件。
 */
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

  /*
   * 第一阶段：
   * 1600x900
   */
  for (
    const quality of qualities
  ) {
    const image =
      source
        .clone()
        .resize(
          1600,
          900
        )
        .quality(
          quality
        )

    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      )

    log(
      `Preview attempt: 1600x900, quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`
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

      return {
        width: 1600,
        height: 900,
        quality,
        size: buffer.length
      }
    }
  }

  /*
   * 第二阶段：
   * 1280x720
   */
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
        .resize(
          1280,
          720
        )
        .quality(
          quality
        )

    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      )

    log(
      `Preview fallback: 1280x720, quality=${quality}, size=${Math.round(buffer.length / 1024)}KB`
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

      return {
        width: 1280,
        height: 720,
        quality,
        size: buffer.length
      }
    }
  }

  throw new Error(
    'Failed to generate preview'
  )
}

/**
 * 根据 Bing API 返回的 enddate
 * 得到这张壁纸真正对应的日期。
 *
 * 不使用 GitHub Actions 当前日期，
 * 避免 Bing 切图时间与北京时间产生错位。
 */
function getBingDate(
  bing
) {
  const date =
    normalizeDate(
      bing && bing.enddate
    )

  if (!date) {
    throw new Error(
      `Bing API returned invalid enddate: ${
        bing && bing.enddate
          ? bing.enddate
          : 'null'
      }`
    )
  }

  return date
}

function loadMonthData(
  jsonFile,
  year,
  month
) {
  const empty = {
    version: 1,
    year: Number(year),
    month: Number(month),
    updatedAt: null,
    items: []
  }

  if (
    !fs.existsSync(
      jsonFile
    )
  ) {
    return empty
  }

  try {
    const data =
      JSON.parse(
        fs.readFileSync(
          jsonFile,
          'utf8'
        )
      )

    return {
      ...empty,
      ...data,
      items:
        Array.isArray(
          data.items
        )
          ? data.items
          : []
    }
  } catch (error) {
    log(
      `Existing JSON is invalid, rebuilding: ${error.message}`
    )

    return empty
  }
}

/**
 * 从 Bing API 获取当天数据。
 */
async function fetchBingMetadata() {
  log(
    `Fetching Bing metadata: ${BING_API_URL}`
  )

  const buffer =
    await requestBuffer(
      BING_API_URL
    )

  let data

  try {
    data =
      JSON.parse(
        buffer.toString(
          'utf8'
        )
      )
  } catch (error) {
    throw new Error(
      `Failed to parse Bing API response: ${error.message}`
    )
  }

  if (
    !data ||
    !Array.isArray(
      data.images
    ) ||
    !data.images[0]
  ) {
    throw new Error(
      'Bing API returned no image.'
    )
  }

  const bing =
    data.images[0]

  const date =
    getBingDate(
      bing
    )

  if (!bing.urlbase) {
    throw new Error(
      `Bing API returned no urlbase for ${date}`
    )
  }

  const sourceImage =
    buildOfficialUhdUrl(
      bing.urlbase
    )

  if (!sourceImage) {
    throw new Error(
      `Unable to build official UHD URL for ${date}`
    )
  }

  return {
    bing,
    date,
    sourceImage
  }
}

/**
 * 从已有 bing-uhd 文件读取图片。
 *
 * 如果存在但无法解析 / 尺寸不够，
 * 直接返回 null，让主流程重新下载。
 */
async function loadExistingUhd(
  uhdImageFile
) {
  if (
    !fs.existsSync(
      uhdImageFile
    )
  ) {
    return null
  }

  try {
    const buffer =
      fs.readFileSync(
        uhdImageFile
      )

    const validated =
      await validateUhdBuffer(
        buffer
      )

    return {
      buffer,
      image:
        validated.image,
      width:
        validated.width,
      height:
        validated.height,
      downloaded: false
    }
  } catch (error) {
    log(
      `Existing UHD is invalid and will be redownloaded: ${uhdImageFile}; ${error.message}`
    )

    return null
  }
}

/**
 * 获取当天 UHD。
 *
 * 优先使用已经存在且有效的 UHD，
 * 不重复下载。
 *
 * 如果不存在或无效：
 * 必须从官方 Bing UHD 下载。
 *
 * 绝不 fallback 到普通 Bing 图片。
 */
async function obtainUhd(
  sourceImage,
  uhdImageFile
) {
  const existing =
    await loadExistingUhd(
      uhdImageFile
    )

  if (existing) {
    log(
      `Using existing UHD: ${uhdImageFile}`
    )

    return existing
  }

  const buffer =
    await downloadImage(
      sourceImage
    )

  const validated =
    await validateUhdBuffer(
      buffer
    )

  fs.mkdirSync(
    path.dirname(
      uhdImageFile
    ),
    {
      recursive: true
    }
  )

  fs.writeFileSync(
    uhdImageFile,
    buffer
  )

  log(
    `UHD image written: ${uhdImageFile} (${validated.width}x${validated.height})`
  )

  return {
    buffer,
    image:
      validated.image,
    width:
      validated.width,
    height:
      validated.height,
    downloaded: true
  }
}

/**
 * 生成或复用当前日期的所有派生数据。
 *
 * 注意：
 * 如果 UHD 是刚下载的，
 * 所有派生数据必须重新计算。
 */
async function buildDerivedData(
  imageBuffer,
  existing
) {
  const image =
    await Jimp.read(
      imageBuffer
    )

  const width =
    image.bitmap.width

  const height =
    image.bitmap.height

  const base64 =
    existing &&
    existing.base64
      ? existing.base64
      : await getBase64(
          imageBuffer
        )

  const color =
    existing &&
    existing.color
      ? existing.color
      : await getMainColors(
          imageBuffer
        )

  const colorHistogram =
    existing &&
    isValidColorHistogram(
      existing.colorHistogram
    )
      ? existing.colorHistogram
      : await getColorHistogram(
          image
        )

  return {
    base64,
    color,
    colorHistogram,
    width,
    height
  }
}

/**
 * 强制从 UHD 重新生成派生数据。
 *
 * 历史修复如果需要全量重新生成，
 * 不应该复用旧 base64/color/histogram。
 */
async function buildFreshDerivedData(
  imageBuffer
) {
  const image =
    await Jimp.read(
      imageBuffer
    )

  const base64 =
    await getBase64(
      imageBuffer
    )

  const color =
    await getMainColors(
      imageBuffer
    )

  const colorHistogram =
    await getColorHistogram(
      image
    )

  return {
    base64,
    color,
    colorHistogram,
    width:
      image.bitmap.width,
    height:
      image.bitmap.height
  }
}

async function main() {
  log(
    '========== Bing wallpaper update =========='
  )

  /*
   * 1. 获取 Bing 当前真正发布的壁纸。
   *
   * 注意：
   * 日期完全以 Bing enddate 为准。
   */
  const {
    bing,
    date,
    sourceImage
  } =
    await fetchBingMetadata()

  const year =
    date.slice(0, 4)

  const month =
    date.slice(5, 7)

  log(
    `Bing wallpaper date: ${date}`
  )

  log(
    `Official sourceImage: ${sourceImage}`
  )

  /*
   * 2. 构造本地文件路径。
   */
  const jsonFile =
    path.join(
      'data',
      year,
      `${month}.json`
    )

  const previewFile =
    path.join(
      'preview',
      year,
      month,
      `${date}.jpg`
    )

  const uhdImageFile =
    path.join(
      'bing-uhd',
      'images',
      year,
      month,
      `${date}.jpg`
    )

  /*
   * 3. 构造稳定镜像 URL。
   */
  const imageUrl =
    buildAssetUrl(
      IMAGE_BASE_URL,
      `images/${year}/${month}/${date}.jpg`
    )

  const previewUrl =
    buildAssetUrl(
      PREVIEW_BASE_URL,
      `preview/${year}/${month}/${date}.jpg`
    )

  /*
   * 4. 读取当月 JSON。
   */
  const monthData =
    loadMonthData(
      jsonFile,
      year,
      month
    )

  const existingIndex =
    monthData.items.findIndex(
      item =>
        item &&
        item.date === date
    )

  const existing =
    existingIndex >= 0
      ? monthData.items[
          existingIndex
        ]
      : null

  /*
   * 5. 获取 UHD。
   *
   * 如果文件已经存在且有效，
   * 不重复下载。
   *
   * 如果不存在 / 损坏：
   * 只允许下载官方 UHD。
   */
  const uhd =
    await obtainUhd(
      sourceImage,
      uhdImageFile
    )

  /*
   * 6. 如果 UHD 是新下载的，
   * 必须从新 UHD 重新计算所有衍生字段。
   *
   * 如果 UHD 已经存在：
   * 对完整字段进行复用。
   */
  const derived =
    uhd.downloaded
      ? await buildFreshDerivedData(
          uhd.buffer
        )
      : await buildDerivedData(
          uhd.buffer,
          existing
        )

  /*
   * 7. Preview：
   *
   * 如果 UHD 刚更新，
   * preview 也必须重新生成。
   *
   * 如果 preview 已存在且 UHD 没变化，
   * 可以直接复用。
   */
  const previewExists =
    fs.existsSync(
      previewFile
    )

  if (
    uhd.downloaded ||
    !previewExists
  ) {
    const previewInfo =
      await generatePreview(
        uhd.buffer,
        previewFile
      )

    log(
      `Preview generated: ${Math.round(previewInfo.size / 1024)}KB`
    )
  } else {
    log(
      `Using existing preview: ${previewFile}`
    )
  }

  /*
   * 8. 使用 Bing 官方 metadata。
   *
   * date：
   * Bing enddate
   *
   * sourceImage：
   * Bing 官方 UHD
   *
   * image：
   * bing-uhd 稳定镜像
   *
   * preview：
   * bing-data preview
   */
  const item = {
    date,

    title:
      bing.title ||
      existing?.title ||
      '',

    description:
      bing.copyright ||
      existing?.description ||
      '',

    copyright:
      bing.copyright ||
      existing?.copyright ||
      '',

    copyrightLink:
      bing.copyrightlink ||
      existing?.copyrightLink ||
      null,

    image:
      imageUrl,

    preview:
      previewUrl,

    sourceImage,

    base64:
      derived.base64,

    color:
      derived.color,

    colorHistogram:
      derived.colorHistogram,

    width:
      derived.width,

    height:
      derived.height,

    id:
      bing.hsh ||
      existing?.id ||
      null,

    startDate:
      bing.startdate ||
      existing?.startDate ||
      null,

    fullStartDate:
      bing.fullstartdate ||
      existing?.fullStartDate ||
      null,

    endDate:
      bing.enddate ||
      existing?.endDate ||
      null
  }

  /*
   * 9. 写回当月 JSON。
   */
  if (
    existingIndex >= 0
  ) {
    monthData.items[
      existingIndex
    ] = item

    log(
      `Updated existing data record: ${date}`
    )
  } else {
    monthData.items.push(
      item
    )

    log(
      `Created new data record: ${date}`
    )
  }

  monthData.items.sort(
    (a, b) =>
      String(a.date)
        .localeCompare(
          String(b.date)
        )
  )

  monthData.updatedAt =
    new Date().toISOString()

  fs.mkdirSync(
    path.dirname(
      jsonFile
    ),
    {
      recursive: true
    }
  )

  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      monthData,
      null,
      2
    ) + '\n',
    'utf8'
  )

  log(
    `Data written: ${jsonFile}`
  )

  /*
   * 10. 重建 index。
   */
  buildIndex()

  log(
    'Index rebuilt.'
  )

  log(
    '========== Bing wallpaper update completed =========='
  )

  log(
    `Date: ${date}`
  )

  log(
    `UHD: ${uhd.width}x${uhd.height}`
  )

  log(
    `sourceImage: ${sourceImage}`
  )

  log(
    `image: ${imageUrl}`
  )

  log(
    `preview: ${previewUrl}`
  )
}

main().catch(error => {
  console.error(
    '========================================'
  )

  console.error(
    'Bing wallpaper update failed.'
  )

  console.error(error)

  console.error(
    '========================================'
  )

  process.exitCode = 1
})