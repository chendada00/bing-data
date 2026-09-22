const Jimp = require('jimp')

const HISTOGRAM_VERSION = 1
const HUE_BINS = 12
const SATURATION_BINS = 3
const VALUE_BINS = 3
const BIN_COUNT = HUE_BINS * SATURATION_BINS * VALUE_BINS
const SAMPLE_WIDTH = 64
const SAMPLE_HEIGHT = 36

function rgbToHsv(r, g, b) {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }

    h *= 60

    if (h < 0) {
      h += 360
    }
  }

  const s = max === 0 ? 0 : delta / max

  return { h, s, v: max }
}

function getBinIndex(hsv) {
  // 低饱和度像素不区分 Hue，避免灰白区域被人为分散。
  const h = hsv.s < 0.15 ? 0 : hsv.h
  const hBin = Math.min(HUE_BINS - 1, Math.floor(h / 30))
  const sBin = Math.min(SATURATION_BINS - 1, Math.floor(hsv.s * SATURATION_BINS))
  const vBin = Math.min(VALUE_BINS - 1, Math.floor(hsv.v * VALUE_BINS))

  return (hBin * SATURATION_BINS + sBin) * VALUE_BINS + vBin
}

function isValidColorHistogram(histogram) {
  return Boolean(
    histogram &&
    histogram.version === HISTOGRAM_VERSION &&
    Array.isArray(histogram.bins) &&
    histogram.bins.length === BIN_COUNT &&
    histogram.bins.some(value => Number(value) > 0)
  )
}

async function getColorHistogram(source) {
  const image = source && source.bitmap
    ? source
    : await Jimp.read(source)

  const sample = image.clone().resize(
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT
  )

  const bins = new Uint32Array(BIN_COUNT)
  const data = sample.bitmap.data
  const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const alpha = data[offset + 3]

    if (alpha === 0) {
      continue
    }

    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]

    bins[getBinIndex(rgbToHsv(r, g, b))]++
  }

  const total = bins.reduce(
    (sum, value) => sum + value,
    0
  )

  if (total === 0) {
    return {
      version: HISTOGRAM_VERSION,
      bins: Array(BIN_COUNT).fill(0)
    }
  }

  return {
    version: HISTOGRAM_VERSION,
    bins: Array.from(
      bins,
      value => Math.round((value / total) * 255)
    )
  }
}

module.exports = {
  HISTOGRAM_VERSION,
  HUE_BINS,
  SATURATION_BINS,
  VALUE_BINS,
  BIN_COUNT,
  isValidColorHistogram,
  getColorHistogram
}
