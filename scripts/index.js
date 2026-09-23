const fs = require('fs')
const path = require('path')

const DATA_ROOT = path.resolve('data')
const INDEX_FILE = path.join(DATA_ROOT, 'index.json')

function collectMonthFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const result = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      result.push(...collectMonthFiles(fullPath))
      continue
    }

    const year = path.basename(path.dirname(fullPath))

    if (
      entry.isFile() &&
      /^\d{4}$/.test(year) &&
      /^\d{2}\.json$/.test(entry.name)
    ) {
      result.push(fullPath)
    }
  }

  return result.sort()
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildIndex() {
  const unique = new Map()

  for (const file of collectMonthFiles(DATA_ROOT)) {
    let data

    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`Invalid month JSON: ${file}: ${error.message}`)
    }

    if (!Array.isArray(data.items)) continue

    for (const item of data.items) {
      if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) {
        continue
      }

      unique.set(item.date, [
        item.date,
        cleanText(item.title),
        cleanText(item.description || item.copyright)
      ])
    }
  }

  const items = Array.from(unique.values()).sort((a, b) =>
    b[0].localeCompare(a[0])
  )

  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items
  }

  fs.mkdirSync(DATA_ROOT, { recursive: true })
  fs.writeFileSync(
    INDEX_FILE,
    JSON.stringify(index) + '\n',
    'utf8'
  )

  console.log(`History index generated: ${items.length} items`)
  console.log(`Index size: ${fs.statSync(INDEX_FILE).size} bytes`)

  return index
}

if (require.main === module) {
  try {
    buildIndex()
  } catch (error) {
    console.error('History index generation failed:', error)
    process.exitCode = 1
  }
}

module.exports = { buildIndex }
