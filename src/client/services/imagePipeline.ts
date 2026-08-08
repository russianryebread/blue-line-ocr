import type { OCRBundle } from '@/shared/scorecard'
import { cloneCalibration, DEFAULT_CALIBRATION, type ScanCalibration } from '@/shared/calibration'

export type PipelineStep = 'orientation' | 'deskew' | 'cleanup' | 'segment'

export interface RegionDefinition {
  label: string
  x: number
  y: number
  width: number
  height: number
  hint: string
}

export const SCORECARD_REGIONS: Record<string, RegionDefinition> = DEFAULT_CALIBRATION.regions

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

export interface ScanInspection {
  source: HTMLCanvasElement
  originalPreviewUrl: string
  orientation: 'portrait' | 'landscape'
}

export interface PipelineArtifact {
  id: string
  label: string
  url: string
  detail: string
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

function drawSource(image: HTMLImageElement, maxDimension = DEFAULT_CALIBRATION.preprocessing.maxDimension): HTMLCanvasElement {
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
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
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

function cleanCanvas(source: HTMLCanvasElement, contrastMultiplier = DEFAULT_CALIBRATION.preprocessing.contrast): HTMLCanvasElement {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas processing is not supported in this browser.')
  const pixels = context.getImageData(0, 0, source.width, source.height)
  const data = pixels.data
  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
    const contrast = Math.max(0, Math.min(255, (luminance - 128) * contrastMultiplier + 128))
    data[index] = contrast
    data[index + 1] = contrast
    data[index + 2] = contrast
  }
  context.putImageData(pixels, 0, 0)
  return source
}

function trimToDocument(source: HTMLCanvasElement): HTMLCanvasElement {
  const sample = document.createElement('canvas')
  sample.width = 240
  sample.height = Math.max(1, Math.round(source.height * sample.width / source.width))
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return source
  sampleContext.drawImage(source, 0, 0, sample.width, sample.height)
  const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
  const luminanceAt = (x: number, y: number) => {
    const index = (y * sample.width + x) * 4
    return 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]
  }

  const cornerSize = Math.max(4, Math.round(Math.min(sample.width, sample.height) * .04))
  const corners = [
    [0, 0], [sample.width - cornerSize, 0],
    [0, sample.height - cornerSize], [sample.width - cornerSize, sample.height - cornerSize]
  ]
  const cornerMean = corners.reduce((sum, [left, top]) => {
    let total = 0
    for (let y = top; y < top + cornerSize; y += 1) {
      for (let x = left; x < left + cornerSize; x += 1) total += luminanceAt(x, y)
    }
    return sum + total / (cornerSize * cornerSize)
  }, 0) / corners.length
  const threshold = Math.max(170, Math.min(220, cornerMean + 35))
  const rowScores = Array.from({ length: sample.height }, (_, y) => {
    let bright = 0
    for (let x = 0; x < sample.width; x += 2) if (luminanceAt(x, y) >= threshold) bright += 1
    return bright / Math.ceil(sample.width / 2)
  })
  const columnScores = Array.from({ length: sample.width }, (_, x) => {
    let bright = 0
    for (let y = 0; y < sample.height; y += 2) if (luminanceAt(x, y) >= threshold) bright += 1
    return bright / Math.ceil(sample.height / 2)
  })

  const findBounds = (scores: number[], minimum: number) => {
    const indexes = scores.map((score, index) => score >= .34 ? index : -1).filter(index => index >= 0)
    if (indexes.length < scores.length * .25) return null
    const first = Math.max(0, indexes[0] - Math.round(scores.length * .012))
    const last = Math.min(scores.length - 1, indexes[indexes.length - 1] + Math.round(scores.length * .012))
    return last - first >= minimum ? { first, last } : null
  }
  const rows = findBounds(rowScores, sample.height * .45)
  const columns = findBounds(columnScores, sample.width * .45)
  if (!rows || !columns) return source

  const left = Math.round(source.width * columns.first / sample.width)
  const top = Math.round(source.height * rows.first / sample.height)
  const right = Math.round(source.width * (columns.last + 1) / sample.width)
  const bottom = Math.round(source.height * (rows.last + 1) / sample.height)
  const width = right - left
  const height = bottom - top
  if (width < source.width * .55 || height < source.height * .45) return source

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return source
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, left, top, width, height, 0, 0, width, height)
  return canvas
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

async function canvasPreviewUrl(canvas: HTMLCanvasElement): Promise<string> {
  try {
    // Data URLs keep previews visible across the orientation, progress, and
    // debug views, including browser environments that do not paint blob URLs
    // created by a canvas into a captured frame.
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    throw new Error('Could not create the image preview.')
  }
}

async function blobPreviewUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not create the region preview.'))
    reader.readAsDataURL(blob)
  })
}

export async function inspectScan(file: File): Promise<ScanInspection> {
  const image = await loadImage(file)
  const source = drawSource(image)
  return {
    source,
    originalPreviewUrl: await canvasPreviewUrl(source),
    orientation: source.height >= source.width ? 'portrait' : 'landscape'
  }
}

export async function orientationPreview(source: HTMLCanvasElement, angle: number): Promise<string> {
  return canvasPreviewUrl(rotateCanvas(source, angle))
}

export async function prepareScan(
  inspection: ScanInspection,
  rotationAngle: number,
  calibration: ScanCalibration = DEFAULT_CALIBRATION,
  onStep: (step: PipelineStep) => void,
  onArtifact?: (artifact: PipelineArtifact) => void
): Promise<PreparedScan> {
  const activeCalibration = cloneCalibration(calibration)
  const source = inspection.source
  let normalizedCanvas = rotationAngle ? rotateCanvas(source, rotationAngle) : source
  // Detect the paper before deskewing so the white fill added by a rotation
  // cannot be mistaken for document pixels at the image corners.
  normalizedCanvas = trimToDocument(normalizedCanvas)

  if (onArtifact) {
    onArtifact({
      id: 'oriented',
      label: 'Oriented',
      url: await canvasPreviewUrl(normalizedCanvas),
      detail: `Manual rotation ${rotationAngle}°`
    })
  }

  onStep('deskew')
  const skewAngle = estimateSkew(normalizedCanvas)
  if (skewAngle) normalizedCanvas = rotateCanvas(normalizedCanvas, skewAngle)
  if (onArtifact) {
    onArtifact({
      id: 'deskewed',
      label: 'Deskewed',
      url: await canvasPreviewUrl(normalizedCanvas),
      detail: `Deskew angle ${skewAngle.toFixed(1)}°`
    })
  }

  onStep('cleanup')
  const croppedCanvas = trimToDocument(normalizedCanvas)
  if (onArtifact) {
    onArtifact({
      id: 'cropped',
      label: 'Document crop',
      url: await canvasPreviewUrl(croppedCanvas),
      detail: `${croppedCanvas.width} × ${croppedCanvas.height}px working page`
    })
  }
  normalizedCanvas = croppedCanvas
  normalizedCanvas = cleanCanvas(normalizedCanvas, activeCalibration.preprocessing.contrast)
  if (onArtifact) {
    onArtifact({
      id: 'cleaned',
      label: 'Cleaned',
      url: await canvasPreviewUrl(normalizedCanvas),
      detail: `Contrast ${activeCalibration.preprocessing.contrast.toFixed(2)}×`
    })
  }

  onStep('segment')
  const overlay = document.createElement('canvas')
  overlay.width = normalizedCanvas.width
  overlay.height = normalizedCanvas.height
  const overlayContext = overlay.getContext('2d')
  overlayContext?.drawImage(normalizedCanvas, 0, 0)
  if (overlayContext) {
    overlayContext.lineWidth = Math.max(2, Math.round(normalizedCanvas.width / 900))
    overlayContext.font = `${Math.max(13, Math.round(normalizedCanvas.width / 55))}px sans-serif`
    Object.entries(activeCalibration.regions).forEach(([key, region]) => {
      const left = normalizedCanvas.width * region.x
      const top = normalizedCanvas.height * region.y
      const width = normalizedCanvas.width * region.width
      const height = normalizedCanvas.height * region.height
      overlayContext.strokeStyle = '#0b86bd'
      overlayContext.fillStyle = 'rgba(11, 134, 189, .12)'
      overlayContext.strokeRect(left, top, width, height)
      overlayContext.fillRect(left, top, width, height)
      overlayContext.fillStyle = '#0b86bd'
      overlayContext.fillText(key, left + 5, top + 18)
    })
  }
  if (onArtifact) {
    onArtifact({
      id: 'segmented',
      label: 'Region map',
      url: await canvasPreviewUrl(overlay),
      detail: `${Object.keys(activeCalibration.regions).length} calibrated regions`
    })
  }
  const entries = await Promise.all(
    Object.entries(activeCalibration.regions).map(async ([key, region]) => {
      const blob = await cropRegion(normalizedCanvas, region)
      if (onArtifact) {
        onArtifact({
          id: `region:${key}`,
          label: region.label,
          url: await blobPreviewUrl(blob),
          detail: `${Math.round(region.x * 100)}%, ${Math.round(region.y * 100)}% · ${Math.round(region.width * 100)}% × ${Math.round(region.height * 100)}%`
        })
      }
      return [key, blob] as const
    })
  )

  return {
    previewUrl: await canvasPreviewUrl(normalizedCanvas),
    regions: Object.fromEntries(entries),
    normalized: { canvas: normalizedCanvas, orientation: inspection.orientation, angle: rotationAngle + skewAngle }
  }
}

export function ocrRegionLabel(bundle: OCRBundle | null | undefined): number {
  if (!bundle?.regions.length) return 0
  return Math.round(bundle.regions.reduce((sum: number, region) => sum + region.confidence, 0) / bundle.regions.length * 100)
}
