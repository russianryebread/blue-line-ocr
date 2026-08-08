import type { OCRField, OCRRegionResult, Scorecard } from '@/shared/scorecard'

const VISION_MODEL_DEFAULT = '@cf/meta/llama-3.2-11b-vision-instruct' as const

type VisionContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface VisionInput extends Record<string, unknown> {
  messages: Array<{
    role: 'system' | 'user'
    content: string | VisionContent[]
  }>
  temperature: number
  max_tokens: number
}

interface VisionOutput {
  response?: unknown
}

interface OCRJson {
  confidence?: number
  rawText?: string
  fields?: Array<Partial<OCRField> & { key: string; value: string | number | null }>
}

const REGION_INSTRUCTIONS: Record<string, string> = {
  header: 'Extract date, time, venue if visible, division, home team, visitor team, referees, and scorekeeper from the header. Use keys game.date, game.time, game.venue, game.division, home.name, visitor.name, officials.referees.0, officials.referees.1, and officials.scorekeeper.',
  homeRoster: 'Extract every visible home player as a jersey number and player name. Use keys home.players.0.number and home.players.0.name, incrementing the index.',
  visitorRoster: 'Extract every visible visitor player as a jersey number and player name. Use keys visitor.players.0.number and visitor.players.0.name, incrementing the index.',
  scoring: 'Extract period scores using score.home.p1, score.home.p2, score.home.p3, score.home.ot, score.home.total, score.visitor.p1, score.visitor.p2, score.visitor.p3, score.visitor.ot, and score.visitor.total. Do not extract goal events from this crop.',
  goalsHome: 'Extract visible home goal events using keys goals.0.team (home), goals.0.period, goals.0.time, goals.0.scorer, goals.0.assist1, and goals.0.assist2, incrementing the index. If the table is empty, return no fields.',
  goalsVisitor: 'Extract visible visitor goal events using keys goals.0.team (visitor), goals.0.period, goals.0.time, goals.0.scorer, goals.0.assist1, and goals.0.assist2, incrementing the index. If the table is empty, return no fields.',
  homeGoalie: 'Extract the home goalie name into home.goalies.0. Ignore printed table lines and numeric totals unless they are clearly handwritten.',
  visitorGoalie: 'Extract the visitor goalie name into visitor.goalies.0. Ignore printed table lines and numeric totals unless they are clearly handwritten.',
  homePenaltiesA: 'Extract visible home penalty rows into penalties.0.team (home), penalties.0.period, penalties.0.time, penalties.0.playerNumber, penalties.0.player, penalties.0.minutes, and penalties.0.infraction, incrementing the index. If empty, return no fields.',
  homePenaltiesB: 'Extract visible home penalty rows into penalties.0.team (home), penalties.0.period, penalties.0.time, penalties.0.playerNumber, penalties.0.player, penalties.0.minutes, and penalties.0.infraction, incrementing the index. If empty, return no fields.',
  visitorPenaltiesA: 'Extract visible visitor penalty rows into penalties.0.team (visitor), penalties.0.period, penalties.0.time, penalties.0.playerNumber, penalties.0.player, penalties.0.minutes, and penalties.0.infraction, incrementing the index. If empty, return no fields.',
  visitorPenaltiesB: 'Extract visible visitor penalty rows into penalties.0.team (visitor), penalties.0.period, penalties.0.time, penalties.0.playerNumber, penalties.0.player, penalties.0.minutes, and penalties.0.infraction, incrementing the index. If empty, return no fields.',
  notes: 'Extract only handwritten notes from the bottom of the sheet into notes. If empty, return no fields.'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function responseText(response: unknown): string {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object') return JSON.stringify(response)
  return response == null ? '' : String(response)
}

function extractJson(text: unknown): OCRJson {
  const rawText = responseText(text)
  const cleaned = rawText.replace(/```json|```/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return { rawText, fields: [] }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as OCRJson
    return {
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.45,
      rawText: typeof parsed.rawText === 'string' ? parsed.rawText : '',
      fields: Array.isArray(parsed.fields) ? parsed.fields : []
    }
  } catch {
    return { rawText, fields: [] }
  }
}

const PLACEHOLDER_VALUES = new Set(['unknown', 'not visible', 'none', 'n/a', 'na', 'null', '...', 'john doe', 'jane smith'])

function normalizeFields(fields: OCRJson['fields'], region: string, fallbackConfidence: number): OCRField[] {
  return (fields ?? []).filter(field => {
    if (!field.key) return false
    const value = field.value === null || field.value === undefined ? '' : String(field.value).trim()
    return !PLACEHOLDER_VALUES.has(value.toLowerCase())
  }).map(field => ({
    key: field.key,
    label: field.label || field.key,
    value: field.value === null || field.value === undefined ? '' : String(field.value),
    confidence: typeof field.confidence === 'number' && field.confidence > 0
      ? Math.max(0, Math.min(1, field.confidence))
      : fallbackConfidence,
    source: field.source || region,
    reviewed: false
  }))
}

export async function recognizeRegion(
  env: Env,
  region: string,
  file: File
): Promise<OCRRegionResult> {
  const image = `data:${file.type || 'image/jpeg'};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`
  const input: VisionInput = {
    messages: [
      {
        role: 'system',
        content: 'You are a careful hockey scorecard transcription engine. Handwriting is uncertain, so never invent unreadable text. Return JSON only.'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${REGION_INSTRUCTIONS[region] || 'Extract the readable text.'}\nReturn exactly {"confidence":0.0,"rawText":"","fields":[{"key":"...","label":"...","value":"...","confidence":0.0}]}. Confidence must describe your certainty for each field.` },
          { type: 'image_url', image_url: { url: image } }
        ]
      }
    ],
    temperature: 0,
    max_tokens: 1800
  }
  const model = env.VISION_MODEL || VISION_MODEL_DEFAULT
  const result = await env.AI.run(model, input)
  const output = result as VisionOutput
  const parsed = extractJson(output.response)
  const fallbackConfidence = typeof parsed.confidence === 'number' && parsed.confidence > 0
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.45
  const fields = normalizeFields(parsed.fields, region, fallbackConfidence)
  return {
    region,
    fields,
    rawText: parsed.rawText || responseText(output.response),
    confidence: fallbackConfidence || (fields.length ? fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length : 0.25)
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor: Record<string, unknown> | unknown[] = target
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    const nextToken = tokens[index + 1]
    if (Array.isArray(cursor)) {
      const position = Number(token)
      if (!cursor[position]) cursor[position] = /^\d+$/.test(nextToken) ? [] : {}
      cursor = cursor[position] as Record<string, unknown> | unknown[]
    } else {
      if (!cursor[token]) cursor[token] = /^\d+$/.test(nextToken) ? [] : {}
      cursor = cursor[token] as Record<string, unknown> | unknown[]
    }
  }
  const last = tokens[tokens.length - 1]
  const numeric = Number(last)
  if (Array.isArray(cursor)) cursor[numeric] = value
  else cursor[last] = value
}

function coerceValue(field: OCRField): string | number {
  if (/\.p[123]|\.ot|\.total$/.test(field.key)) {
    const parsed = Number(field.value.replace(/[^0-9-]/g, ''))
    return Number.isFinite(parsed) ? parsed : field.value
  }
  return field.value
}

export function applyOCRToScorecard(scorecard: Scorecard, regions: OCRRegionResult[]): Scorecard {
  const next = JSON.parse(JSON.stringify(scorecard)) as Scorecard
  const root = next as unknown as Record<string, unknown>
  regions.flatMap(region => region.fields).forEach(field => setPath(root, field.key, coerceValue(field)))
  return next
}
