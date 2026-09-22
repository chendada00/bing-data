const fs = require('fs')
const path = require('path')

const {
  HISTOGRAM_VERSION,
  isValidColorHistogram,
  getColorHistogram
} = require('./color-histogram')

const DATA_ROOT = path.resolve('data')
const IMAGE_ROOT = path.resolve('images')

const START_YEAR = Number(process.env.START_YEAR || 0)
const END_YEAR = Number(process.env.END_YEAR || 9999)

function listMonthFiles(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }

  const result = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      result.push(...listMonthFiles(fullPath))
      continue
    }

    const yearName = path.basename(path.dirname(fullPath))

    if (
      entry.isFile() &&
      /^\d{2}\.json$/.test(entry.name) &&
      /^\d{4}$/.test(yearName)
    ) {
      const year = Number(yearName)

      if (year >= START_YEAR && year <= END_YEAR) {
        result.push(fullPath)
      }
    }
  }

  return result.sort()
}

function imagePathForDate(date) {
  const year = date.substring(0, 4)
  const month = date.substring(5, 7)

  return path.join(
    IMAGE_ROOT,
    year,
    month,
    `${date}.jpg`
  )
}

function saveJson(filePath, data) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  )
}

async function processMonth(filePath) {
  const data = JSON.parse(
    fs.readFileSync(filePath, 'utf8')
  )

  if (!Array.isArray(data.items)) {
    return {
      updated: false,
      generated: 0,
      skipped: 0,
      failed: 0
    }
  }

  let changed = false
  let generated = 0
  let skipped = 0
  let failed = 0

  for (const item of data.items) {
    if (isValidColorHistogram(item.colorHistogram)) {
      skipped++
      continue
    }

    if (
      !item.date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) {
      failed++
      console.warn('[unknown] invalid date')
      continue
    }

    const imagePath = imagePathForDate(item.date)

    if (!fs.existsSync(imagePath)) {
      failed++
      console.warn(
        `[${item.date}] image not found: ${imagePath}`
      )
      continue
    }

    try {
      item.colorHistogram =
        await getColorHistogram(imagePath)

      if (
        item.colorHistogram.version !==
        HISTOGRAM_VERSION
      ) {
        throw new Error('Unexpected histogram version')
      }

      changed = true
      generated++

      console.log(
        `[${item.date}] histogram generated`
      )
    } catch (error) {
      failed++

      console.error(
        `[${item.date}] histogram failed: ${error.message}`
      )
    }
  }

  if (changed) {
    data.items.sort((a, b) =>
      String(b.date || '').localeCompare(
        String(a.date || '')
      )
    )

    data.updatedAt = new Date().toISOString()
    saveJson(filePath, data)
  }

  return {
    updated: changed,
    generated,
    skipped,
    failed
  }
}

async function main() {
  console.log('========================================')
  console.log('Bing Wallpaper Color Histogram Backfill')
  console.log('========================================')
  console.log(
    `START_YEAR: ${START_YEAR || '(all)'}`
  )
  console.log(
    `END_YEAR: ${
      END_YEAR === 9999
        ? '(all)'
        : END_YEAR
    }`
  )

  const files = listMonthFiles(DATA_ROOT)

  console.log(`Month files: ${files.length}`)

  let updatedFiles = 0
  let generated = 0
  let skipped = 0
  let failed = 0

  for (const filePath of files) {
    console.log('')
    console.log(`Processing: ${filePath}`)

    const result = await processMonth(filePath)

    if (result.updated) {
      updatedFiles++
    }

    generated += result.generated
    skipped += result.skipped
    failed += result.failed
  }

  console.log('')
  console.log('========================================')
  console.log('Histogram backfill completed')
  console.log('========================================')
  console.log(`Updated files: ${updatedFiles}`)
  console.log(`Generated: ${generated}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
