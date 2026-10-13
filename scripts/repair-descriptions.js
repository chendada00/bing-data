
const fs = require('fs')
const path = require('path')

const { fetchDescription, isUsableDescription } =
  require('./bing-description')

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
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    ? value
    : null
}

function collectMonthFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true
  })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectMonthFiles(fullPath))
    } else {
      const year = path.basename(path.dirname(fullPath))

      if (
        entry.isFile() &&
        /^\d{4}$/.test(year) &&
        /^\d{2}\.json$/.test(entry.name)
      ) {
        files.push(fullPath)
      }
    }
  }

  return files.sort()
}

function needsRepair(item) {
  const description = String(item.description || '').trim()
  const copyright = String(item.copyright || '').trim()

  if (!description) return true
  if (description === copyright) return true

  if (item.descriptionSource === 'bing-copyright') {
    return true
  }

  return false
}

async function main() {
  const files = collectMonthFiles(DATA_ROOT)
    .filter(file => {
      if (YEAR === 'all') return true
      return path.basename(path.dirname(file)) === YEAR
    })

  let checked = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(original)

    if (!Array.isArray(data.items)) continue

    let changed = false

    for (const item of data.items) {
      const date = normalizeDate(item.date)

      if (!date) continue
      if (START_DATE && date < START_DATE) continue
      if (END_DATE && date > END_DATE) continue

      if (!FORCE && !needsRepair(item)) {
        skipped++
        continue
      }

      if (LIMIT > 0 && checked >= LIMIT) {
        break
      }

      checked++

      try {
        const description = await fetchDescription(
          date,
          item.copyright || ''
        )

        if (
          !isUsableDescription(
            description,
            item.copyright || ''
          )
        ) {
          console.log(`[SKIP] ${date}: no verified description`)
          skipped++
          continue
        }

        if (
          item.description === description &&
          item.descriptionSource === 'bing-story-page'
        ) {
          skipped++
          continue
        }

        // 只修改这两个字段。
        item.description = description
        item.descriptionSource = 'bing-story-page'

        changed = true
        updated++

        console.log(`[UPDATED] ${date}`)
      } catch (error) {
        failed++
        console.error(`[FAILED] ${date}: ${error.message}`)
      }

      await sleep(DELAY_MS)
    }

    if (changed) {
      // 不改 updatedAt 等其他月度元数据，避免扩大修改范围。
      fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
      )

      console.log(`[SAVED] ${path.relative(process.cwd(), file)}`)
    }
  }

  if (updated > 0) {
    // index.json 是 description 的派生索引，必须同步重建。
    buildIndex()
  }

  console.log('========== Description repair summary ==========')
  console.log(`Checked: ${checked}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)

  // 只要存在获取失败，Action 就明确显示失败，
  // 但已成功获取的描述仍然保留。
  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('Description repair failed:', error)
  process.exitCode = 1
})
