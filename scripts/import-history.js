const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const Jimp = require('jimp')
const Vibrant = require('node-vibrant')

const ROOT = process.cwd()

const IMAGE_ROOT = path.join(ROOT, 'images')
const PREVIEW_ROOT = path.join(ROOT, 'preview')
const DATA_ROOT = path.join(ROOT, 'data')

const SOURCE_URL =
  'https://raw.githubusercontent.com/zkeq/Bing-Wallpaper-Action/master/data/zh-CN_update.json'

const DAYS = Number(process.env.DAYS || 5)

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    })
  }
}

function fileExists(file) {
  return fs.existsSync(file)
}

function request(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://')
      ? https
      : http

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 Bing-Wallpaper-History-Importer'
        }
      },
      res => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()

          request(res.headers.location, timeout)
            .then(resolve)
            .catch(reject)

          return
        }

        if (res.statusCode !== 200) {
          res.resume()

          reject(
            new Error(
              `HTTP ${res.statusCode}: ${url}`
            )
          )

          return
        }

        const chunks = []

        res.on('data', chunk => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          resolve(
            Buffer.concat(chunks)
          )
        })
      }
    )

    req.setTimeout(timeout, () => {
      req.destroy(
        new Error(
          `Request timeout: ${url}`
        )
      )
    })

    req.on('error', reject)
  })
}

async function download(url, target) {
  if (fileExists(target)) {
    log(`已存在，跳过下载：${target}`)
    return
  }

  log(`下载：${url}`)

  const buffer = await request(url)

  ensureDir(path.dirname(target))

  fs.writeFileSync(target, buffer)

  log(
    `下载完成：${target} (${Math.round(buffer.length / 1024)} KB)`
  )
}

function buildUhdUrl(item) {
  if (!item.urlbase) {
    if (!item.url) {
      return null
    }

    return item.url.startsWith('http')
      ? item.url
      : `https://cn.bing.com${item.url}`
  }

  return (
    `https://cn.bing.com${item.urlbase}_UHD.jpg`
  )
}

function buildFallbackUrl(item) {
  if (!item.url) {
    return null
  }

  return item.url.startsWith('http')
    ? item.url
    : `https://cn.bing.com${item.url}`
}

async function downloadImage(item, target) {
  const uhdUrl = buildUhdUrl(item)

  if (uhdUrl) {
    try {
      await download(uhdUrl, target)

      return uhdUrl
    } catch (error) {
      log(
        `UHD 下载失败，尝试普通图片：${error.message}`
      )
    }
  }

  const fallbackUrl =
    buildFallbackUrl(item)

  if (!fallbackUrl) {
    throw new Error(
      '没有可用图片 URL'
    )
  }

  await download(
    fallbackUrl,
    target
  )

  return fallbackUrl
}

async function generatePreview(
  source,
  target
) {
  if (fileExists(target)) {
    log(`Preview 已存在：${target}`)
    return
  }

  log(`生成 Preview：${target}`)

  const image =
    await Jimp.read(source)

  image
    .contain(
      1200,
      675
    )
    .quality(82)

  ensureDir(path.dirname(target))

  await new Promise(
    (resolve, reject) => {
      image.write(
        target,
        error => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        }
      )
    }
  )
}

async function generateBase64(source) {
  const image =
    await Jimp.read(source)

  image.contain(
    32,
    18
  )

  image.quality(40)

  const buffer =
    await new Promise(
      (resolve, reject) => {
        image.getBuffer(
          Jimp.MIME_JPEG,
          (error, data) => {
            if (error) {
              reject(error)
            } else {
              resolve(data)
            }
          }
        )
      }
    )

  return `data:image/jpeg;base64,${buffer.toString(
    'base64'
  )}`
}

async function extractColor(source) {
  try {
    const palette =
      await Vibrant.from(source).getPalette()

    const result = {}

    const names = [
      'Vibrant',
      'DarkVibrant',
      'LightVibrant',
      'Muted',
      'DarkMuted',
      'LightMuted'
    ]

    for (const name of names) {
      const swatch = palette[name]

      if (swatch) {
        result[name] =
          swatch.getHex()
      }
    }

    return result
  } catch (error) {
    log(
      `颜色提取失败：${error.message}`
    )

    return {}
  }
}

function getMonthFile(year, month) {
  const dir = path.join(
    DATA_ROOT,
    String(year)
  )

  ensureDir(dir)

  return path.join(
    dir,
    `${String(month).padStart(2, '0')}.json`
  )
}

function readMonthData(year, month) {
  const file =
    getMonthFile(year, month)

  if (!fileExists(file)) {
    return {
      version: 1,
      year,
      month,
      updatedAt:
        new Date().toISOString(),
      items: []
    }
  }

  try {
    const data =
      JSON.parse(
        fs.readFileSync(
          file,
          'utf8'
        )
      )

    if (!Array.isArray(data.items)) {
      data.items = []
    }

    return data
  } catch (error) {
    throw new Error(
      `读取月数据失败：${file} - ${error.message}`
    )
  }
}

function saveMonthData(
  year,
  month,
  data
) {
  data.items.sort(
    (a, b) =>
      b.date.localeCompare(a.date)
  )

  data.updatedAt =
    new Date().toISOString()

  const file =
    getMonthFile(year, month)

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

function formatDate(
  value
) {
  const text =
    String(value)

  return `${text.slice(0, 4)}-${text.slice(
    4,
    6
  )}-${text.slice(6, 8)}`
}

function getTargetDates(items) {
  const today =
    new Date()

  const result = []

  for (
    let i = 1;
    i <= DAYS;
    i++
  ) {
    const date =
      new Date(today)

    date.setUTCDate(
      date.getUTCDate() - i
    )

    const dateText =
      date.toISOString()
        .slice(0, 10)

    result.push(dateText)
  }

  return result
}

async function main() {
  log(
    `开始导入历史数据，目标天数：${DAYS}`
  )

  const sourceBuffer =
    await request(
      SOURCE_URL
    )

  const source =
    JSON.parse(
      sourceBuffer.toString('utf8')
    )

  if (!Array.isArray(source)) {
    throw new Error(
      '历史数据格式不是数组'
    )
  }

  log(
    `远程历史数据共 ${source.length} 条`
  )

  const targetDates =
    getTargetDates(source)

  log(
    `本次目标日期：${targetDates.join(', ')}`
  )

  const map =
    new Map()

  for (const item of source) {
    if (!item.startdate) {
      continue
    }

    map.set(
      formatDate(item.startdate),
      item
    )
  }

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const date of targetDates) {
    const item =
      map.get(date)

    if (!item) {
      log(
        `找不到历史数据：${date}`
      )

      continue
    }

    const year =
      Number(date.slice(0, 4))

    const month =
      Number(date.slice(5, 7))

    const imageFile =
      path.join(
        IMAGE_ROOT,
        String(year),
        String(month).padStart(2, '0'),
        `${date}.jpg`
      )

    const previewFile =
      path.join(
        PREVIEW_ROOT,
        String(year),
        String(month).padStart(2, '0'),
        `${date}.jpg`
      )

    try {
      const monthData =
        readMonthData(
          year,
          month
        )

      const existingIndex =
        monthData.items.findIndex(
          value =>
            value.date === date
        )

      if (
        existingIndex >= 0 &&
        monthData.items[
          existingIndex
        ].preview &&
        fileExists(previewFile)
      ) {
        log(
          `数据已经存在，跳过：${date}`
        )

        skipped++

        continue
      }

      const sourceImage =
        await downloadImage(
          item,
          imageFile
        )

      await generatePreview(
        imageFile,
        previewFile
      )

      const base64 =
        await generateBase64(
          imageFile
        )

      const color =
        await extractColor(
          imageFile
        )

      const imageUrl =
        `https://raw.githubusercontent.com/chendada00/bing-data/main/images/${year}/${String(
          month
        ).padStart(2, '0')}/${date}.jpg`

      const previewUrl =
        `https://raw.githubusercontent.com/chendada00/bing-data/main/preview/${year}/${String(
          month
        ).padStart(2, '0')}/${date}.jpg`

      const result = {
        date,
        title:
          item.title || '',
        description:
          item.copyright || '',
        copyright:
          item.copyright || '',
        copyrightLink:
          item.copyrightlink || '',
        image:
          imageUrl,
        preview:
          previewUrl,
        sourceImage,
        base64,
        color,
        width: 3840,
        height: 2160,
        id:
          item.hsh || '',
        startDate:
          item.startdate || '',
        fullStartDate:
          item.fullstartdate || '',
        endDate:
          item.enddate || ''
      }

      if (existingIndex >= 0) {
        monthData.items[
          existingIndex
        ] = result
      } else {
        monthData.items.push(
          result
        )
      }

      saveMonthData(
        year,
        month,
        monthData
      )

      imported++

      log(
        `导入成功：${date}`
      )

      await sleep(300)
    } catch (error) {
      failed++

      log(
        `导入失败：${date} - ${error.stack || error.message}`
      )
    }
  }

  log('==============================')
  log(`导入完成`)
  log(`成功：${imported}`)
  log(`跳过：${skipped}`)
  log(`失败：${failed}`)
  log('==============================')

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)

  process.exitCode = 1
})