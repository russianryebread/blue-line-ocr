import type { OCRBundle } from '@/shared/scorecard'

export type PipelineStep = 'orientation' | 'deskew' | 'cleanup' | 'segment'

export interface RegionDefinition {
  label: string
  x: number
  y: number
  width: number
  height: number
  hint: string
}

export const SCORECARD_REGIONS: Record<string, RegionDefinition> = {
  header: {
    label: 'Game header', x: 0.22, y: 0.04, width: 0.56, height: 0.12,
    hint: 'Extract date, time, venue, division, and team names.'
  },
  homeRoster: {
    label: 'Home roster', x: 0.04, y: 0.18, width: 0.22, height: 0.40,
    hint: 'Extract player jersey numbers and names.'
  },
  visitorRoster: {
    label: 'Visitor roster', x: 0.74, y: 0.18, width: 0.22, height: 0.40,
    hint: 'Extract player jersey numbers and names.'
  },
  scoring: {
    label: 'Scoring summary', x: 0.28, y: 0.20, width: 0.44, height: 0.30,
    hint: 'Extract period scores and goal events.'
  },
  goalies: {
    label: 'Goalies', x: 0.04, y: 0.61, width: 0.92, height: 0.12,
    hint: 'Extract goalie names and save or shot totals when present.'
  },
  penalties: {
    label: 'Penalties', x: 0.04, y: 0.73, width: 0.92, height: 0.18,
    hint: 'Extract period, player, minutes, time, and infraction.'
  },
  officials: {
    label: 'Officials and notes', x: 0.04, y: 0.92, width: 0.92, height: 0.06,
    hint: 'Extract officials and any handwritten notes.'
  }
}

interface NormalizedImage {
  canvas: HTMLCanvasElement
  orientation: string
  angle: number
}

export interface PreparedScan {
  previewUrl: string
  regions: Record<string, Blob>
  normalized: NormalizedImage
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The image could not be opened.'))
    }
    image.src = url
  })
}

function drawSource(image: HTMLImageElement, maxDimension = 2600): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

function rotateCanvas(source: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const radians = angle * Math.PI / 180
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(source.width * cos + source.height * sin)
  canvas.height = Math.ceil(source.width * sin + source.height * cos)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(radians)
  context.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

function estimateSkew(source: HTMLCanvasElement): number {
  const preview = document.createElement('canvas')
  const width = 360
  preview.width = width
  preview.height = Math.max(1, Math.round(source.height * width / source.width))
  const context = preview.getContext('2d', { willReadFrequently: true })
  if (!context) return 0
  context.drawImage(source, 0, 0, preview.width, preview.height)
  const pixels = context.getImageData(0, 0, preview.width, preview.height).data

  const darkness = (x: number, y: number) => {
    const index = (y * preview.width + x) * 4
    const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3
    return value < 170 ? 1 : 0
  }

  let bestAngle = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let angle = -4; angle <= 4; angle += 0.5) {
    const radians = angle * Math.PI / 180
    let score = 0
    for (let y = 8; y < preview.height - 8; y += 4) {
      let row = 0
      for (let x = 8; x < preview.width - 8; x += 3) {
        const shiftedY = Math.round(y + (x - preview.width / 2) * Math.tan(radians))
        if (shiftedY >= 0 && shiftedY < preview.height) row += darkness(x, shiftedY)
      }
      score += row * row
    }
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }
  return Math.abs(bestAngle) < 0.5 ? 0 : -bestAngle
}

function cleanCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  const pixels = context.getImageData(0, 0, source.width, source.height)
  const data = pixels.data
  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
    const contrast = Math.max(0, Math.min(255, (luminance - 128) * 1.22 + 128))
    data[index] = contrast
    data[index + 1] = contrast
    data[index + 2] = contrast
  }
  context.putImageData(pixels, 0, 0)
  return source
}

function cropRegion(source: HTMLCanvasElement, region: RegionDefinition): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * region.width))
  canvas.height = Math.max(1, Math.round(source.height * region.height))
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('Canvas processing is not supported in this browser.'))
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    source,
    Math.round(source.width * region.x), Math.round(source.height * region.y),
    canvas.width, canvas.height,
    0, 0, canvas.width, canvas.height
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(`Could not crop ${region.label}.`)), 'image/jpeg', 0.9)
  })
}

export async function prepareScan(
  file: File,
  onStep: (step: PipelineStep) => void
): Promise<PreparedScan> {
  const image = await loadImage(file)
  onStep('orientation')
  const source = drawSource(image)
  const orientation = source.height >= source.width ? 'portrait' : 'landscape'
  let normalizedCanvas = source

  if (orientation === 'landscape') normalizedCanvas = rotateCanvas(source, 90)

  onStep('deskew')
  const angle = estimateSkew(normalizedCanvas)
  if (angle) normalizedCanvas = rotateCanvas(normalizedCanvas, angle)

  onStep('cleanup')
  normalizedCanvas = cleanCanvas(normalizedCanvas)

  onStep('segment')
  const entries = await Promise.all(
    Object.entries(SCORECARD_REGIONS).map(async ([key, region]) => [key, await cropRegion(normalizedCanvas, region)] as const)
  )

  const previewBlob = await new Promise<Blob>((resolve, reject) => {
    normalizedCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the normalized preview.')), 'image/jpeg', 0.86)
  })

  return {
    previewUrl: URL.createObjectURL(previewBlob),
    regions: Object.fromEntries(entries),
    normalized: { canvas: normalizedCanvas, orientation, angle }
  }
}

export function ocrRegionLabel(bundle: OCRBundle | null | undefined): number {
  if (!bundle?.regions.length) return 0
  return Math.round(bundle.regions.reduce((sum: number, region) => sum + region.confidence, 0) / bundle.regions.length * 100)
}
