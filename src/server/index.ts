import { Hono } from 'hono'
import type { Context } from 'hono'
import type { GameSummary, OCRBundle, OCRRegionResult, Scorecard } from '@/shared/scorecard'
import { blankScorecard } from '@/shared/scorecard'
import { cloneCalibration, DEFAULT_CALIBRATION, type CalibrationRegion, type ScanCalibration } from '@/shared/calibration'
import { applyOCRToScorecard, recognizeRegion } from './ocr'

type AppBindings = {
  Bindings: Env
}

const app = new Hono<AppBindings>()

function jsonError(c: Context<AppBindings>, message: string, status = 400): Response {
  return c.json({ error: message }, status as 400)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function scoreValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeScorecard(input: unknown): Scorecard {
  const candidate = (input && typeof input === 'object' ? input : {}) as Partial<Scorecard>
  const base = blankScorecard()
  const value = JSON.parse(JSON.stringify(base)) as Scorecard
  value.id = stringValue(candidate.id) || undefined
  value.game = { ...value.game, ...(candidate.game || {}) }
  value.officials = { ...value.officials, ...(candidate.officials || {}) }
  value.home = { ...value.home, ...(candidate.home || {}) }
  value.visitor = { ...value.visitor, ...(candidate.visitor || {}) }
  value.score = {
    home: { ...value.score.home, ...(candidate.score?.home || {}) },
    visitor: { ...value.score.visitor, ...(candidate.score?.visitor || {}) }
  }
  value.goals = Array.isArray(candidate.goals) ? candidate.goals : []
  value.penalties = Array.isArray(candidate.penalties) ? candidate.penalties : []
  value.notes = stringValue(candidate.notes)
  value.score.home.total = scoreValue(value.score.home.total)
  value.score.visitor.total = scoreValue(value.score.visitor.total)
  for (const period of ['p1', 'p2', 'p3', 'ot'] as const) {
    value.score.home[period] = scoreValue(value.score.home[period])
    value.score.visitor[period] = scoreValue(value.score.visitor[period])
  }
  return value
}

function summaryFromRow(row: Record<string, unknown>): GameSummary {
  return {
    id: String(row.id),
    game_date: String(row.game_date || ''),
    game_time: String(row.game_time || ''),
    venue: String(row.venue || ''),
    home_team: String(row.home_team || ''),
    visitor_team: String(row.visitor_team || row.visiting_team || ''),
    home_score: scoreValue(row.home_score),
    visitor_score: scoreValue(row.visitor_score),
    status: String(row.status || 'draft'),
    updated_at: String(row.updated_at || '')
  }
}

function rowToGame(row: Record<string, unknown>) {
  const stored = String(row.scorecard_json || row.data || '{}')
  return {
    ...summaryFromRow(row),
    scorecard: parseStoredScorecard(stored, String(row.id)),
    ocr: row.ocr_json ? JSON.parse(String(row.ocr_json)) as OCRBundle : null
  }
}

function parseStoredScorecard(serialized: string, id: string): Scorecard {
  const raw = JSON.parse(serialized) as Partial<Scorecard> & {
    meta?: { date?: string; gameTime?: string; division?: string; referees?: string[]; scorekeeper?: string }
    score?: { home?: Record<string, unknown>; visiting?: Record<string, unknown> }
    homeTeam?: { name?: string; players?: Array<{ number?: number; name?: string }>; goalkeeper?: { name?: string }; timeouts?: number; goals?: Array<Record<string, unknown>>; penalties?: Array<Record<string, unknown>> }
    visitingTeam?: { name?: string; players?: Array<{ number?: number; name?: string }>; goalkeeper?: { name?: string }; timeouts?: number; goals?: Array<Record<string, unknown>>; penalties?: Array<Record<string, unknown>> }
    gameNotes?: string
  }
  if (raw.game && raw.home && raw.visitor) return { ...raw, id } as Scorecard

  const legacyTeam = (team: typeof raw.homeTeam, side: 'home' | 'visitor') => ({
    name: team?.name || '',
    players: (team?.players || []).map(player => ({ number: String(player.number ?? ''), name: player.name || '' })),
    goalies: [team?.goalkeeper?.name || ''],
    timeout: team?.timeouts ? String(team.timeouts) : ''
  })
  const legacyScore = (line: Record<string, unknown> | undefined) => ({
    p1: scoreValue(line?.period1), p2: scoreValue(line?.period2), p3: scoreValue(line?.period3),
    ot: scoreValue(line?.ot), total: scoreValue(line?.total)
  })
  const legacyEvents = (team: typeof raw.homeTeam, side: 'home' | 'visitor') => [
    ...(team?.goals || []).map((goal, index) => ({
      id: `${id}-goal-${side}-${index}`, team: side, period: String(goal.period ?? ''), time: String(goal.time ?? ''),
      scorer: String(goal.scorerNumber ?? ''), assist1: String(goal.assist1Number ?? ''), assist2: String(goal.assist2Number ?? '')
    })),
    ...(team?.penalties || []).map((penalty, index) => ({
      id: `${id}-pen-${side}-${index}`, team: side, period: String(penalty.period ?? ''), time: String(penalty.startTime ?? ''),
      playerNumber: String(penalty.playerNumber ?? ''), player: String(penalty.playerName ?? ''), minutes: String(penalty.minutes ?? ''), infraction: String(penalty.offense ?? '')
    }))
  ]
  const homeTeam = legacyTeam(raw.homeTeam, 'home')
  const visitorTeam = legacyTeam(raw.visitingTeam, 'visitor')
  return {
    id,
    game: { date: raw.meta?.date || '', time: raw.meta?.gameTime || '', venue: '', division: raw.meta?.division || '' },
    officials: { referees: raw.meta?.referees || ['', ''], scorekeeper: raw.meta?.scorekeeper || '' },
    home: homeTeam,
    visitor: visitorTeam,
    score: { home: legacyScore(raw.score?.home), visitor: legacyScore(raw.score?.visiting) },
    goals: [...legacyEvents(raw.homeTeam, 'home'), ...legacyEvents(raw.visitingTeam, 'visitor')].filter(event => 'scorer' in event),
    penalties: [...legacyEvents(raw.homeTeam, 'home'), ...legacyEvents(raw.visitingTeam, 'visitor')].filter(event => 'player' in event) as Scorecard['penalties'],
    notes: raw.gameNotes || ''
  }
}

function commonHeaders(): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
}

function debugEnabled(env: Env): boolean {
  const value = String(env.SCORECARD_DEBUG).toLowerCase()
  return value === 'true' || value === '1'
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function sanitizeCalibration(input: unknown): ScanCalibration {
  const candidate = input && typeof input === 'object' ? input as Partial<ScanCalibration> : {}
  const next = cloneCalibration(DEFAULT_CALIBRATION)
  next.version = Math.max(1, Math.round(clamp(candidate.version, 1, 999, 1)))
  next.preprocessing.maxDimension = Math.round(clamp(candidate.preprocessing?.maxDimension, 1000, 5000, next.preprocessing.maxDimension))
  next.preprocessing.contrast = clamp(candidate.preprocessing?.contrast, 0.8, 2.2, next.preprocessing.contrast)
  const regions = candidate.regions && typeof candidate.regions === 'object' ? candidate.regions as Record<string, Partial<CalibrationRegion>> : {}
  Object.entries(next.regions).forEach(([key, region]) => {
    const override = regions[key]
    if (!override) return
    region.x = clamp(override.x, 0, 0.98, region.x)
    region.y = clamp(override.y, 0, 0.98, region.y)
    region.width = clamp(override.width, 0.02, 1 - region.x, region.width)
    region.height = clamp(override.height, 0.02, 1 - region.y, region.height)
  })
  next.updatedAt = new Date().toISOString()
  return next
}

app.get('/api/config', async c => {
  if (!debugEnabled(c.env)) return c.json({ debug: false }, 200, commonHeaders())
  const row = await c.env.DB.prepare('SELECT config_json, updated_at FROM scan_calibrations WHERE id = ?').bind('default').first<{ config_json: string; updated_at: string }>()
  const calibration = row ? sanitizeCalibration(JSON.parse(row.config_json)) : cloneCalibration(DEFAULT_CALIBRATION)
  calibration.updatedAt = row?.updated_at || calibration.updatedAt
  return c.json({ debug: true, calibration }, 200, commonHeaders())
})

app.put('/api/debug/calibration', async c => {
  if (!debugEnabled(c.env)) return jsonError(c, 'Debug mode is disabled.', 404)
  const payload = await c.req.json<{ calibration?: unknown }>().catch(() => null)
  if (!payload?.calibration) return jsonError(c, 'A calibration object is required.')
  const calibration = sanitizeCalibration(payload.calibration)
  await c.env.DB.prepare(
    `INSERT INTO scan_calibrations (id, version, config_json, updated_at) VALUES ('default', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, config_json = excluded.config_json, updated_at = excluded.updated_at`
  ).bind(calibration.version, JSON.stringify(calibration), calibration.updatedAt).run()
  return c.json({ calibration }, 200, commonHeaders())
})

app.get('/api/games', async c => {
  const result = await c.env.DB.prepare(
    'SELECT id, game_date, game_time, venue, home_team, visitor_team, home_score, visitor_score, status, updated_at FROM games ORDER BY updated_at DESC LIMIT 50'
  ).all<Record<string, unknown>>()
  return c.json(result.results.map(summaryFromRow), 200, commonHeaders())
})

app.get('/api/games/:id', async c => {
  const row = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>()
  if (!row) return jsonError(c, 'Game not found.', 404)
  return c.json(rowToGame(row), 200, commonHeaders())
})

app.post('/api/games', async c => {
  const payload = await c.req.json<{ scorecard?: unknown; ocr?: OCRBundle | null }>().catch(() => null)
  if (!payload?.scorecard) return jsonError(c, 'A scorecard is required.')
  const scorecard = normalizeScorecard(payload.scorecard)
  const id = crypto.randomUUID()
  scorecard.id = id
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO games (id, created_at, updated_at, game_date, game_time, venue, division, home_team, visiting_team, visitor_team, home_score, visitor_score, status, data, scorecard_json, ocr_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).bind(
    id, now, now, scorecard.game.date, scorecard.game.time, scorecard.game.venue, scorecard.game.division,
    scorecard.home.name, scorecard.visitor.name, scorecard.visitor.name, scoreValue(scorecard.score.home.total), scoreValue(scorecard.score.visitor.total),
    JSON.stringify(scorecard), JSON.stringify(scorecard), payload.ocr ? JSON.stringify(payload.ocr) : null
  ).run()
  const row = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Record<string, unknown>>()
  return c.json(rowToGame(row as Record<string, unknown>), 201, commonHeaders())
})

app.put('/api/games/:id', async c => {
  const payload = await c.req.json<{ scorecard?: unknown; ocr?: OCRBundle | null }>().catch(() => null)
  if (!payload?.scorecard) return jsonError(c, 'A scorecard is required.')
  const existing = await c.env.DB.prepare('SELECT id FROM games WHERE id = ?').bind(c.req.param('id')).first()
  if (!existing) return jsonError(c, 'Game not found.', 404)
  const scorecard = normalizeScorecard(payload.scorecard)
  scorecard.id = c.req.param('id')
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE games SET updated_at = ?, game_date = ?, game_time = ?, venue = ?, division = ?, home_team = ?, visiting_team = ?, visitor_team = ?, home_score = ?, visitor_score = ?, data = ?, scorecard_json = ?, ocr_json = ? WHERE id = ?`
  ).bind(
    now, scorecard.game.date, scorecard.game.time, scorecard.game.venue, scorecard.game.division,
    scorecard.home.name, scorecard.visitor.name, scorecard.visitor.name, scoreValue(scorecard.score.home.total), scoreValue(scorecard.score.visitor.total),
    JSON.stringify(scorecard), JSON.stringify(scorecard), payload.ocr ? JSON.stringify(payload.ocr) : null, c.req.param('id')
  ).run()
  const row = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>()
  return c.json(rowToGame(row as Record<string, unknown>), 200, commonHeaders())
})

app.post('/api/scan', async c => {
  const form = await c.req.parseBody()
  const regionNames = Object.keys(form).filter(name => name !== 'source')
  if (!regionNames.length) return jsonError(c, 'No scorecard regions were uploaded.')
  const files = regionNames.map(name => ({ name, file: form[name] })).filter(
    (entry): entry is { name: string; file: File } => entry.file instanceof File && entry.file.size > 0
  )
  if (!files.length) return jsonError(c, 'The uploaded regions were empty.')
  if (files.some(entry => entry.file.size > 4_000_000)) return jsonError(c, 'One or more image regions are too large.')

  const results = await Promise.all(files.map(entry => recognizeRegion(c.env, entry.name, entry.file)))
  const scorecard = applyOCRToScorecard(blankScorecard(), results)
  const ocr: OCRBundle = { regions: results, processedAt: new Date().toISOString() }
  return c.json({
    scorecard,
    ocr,
    diagnostics: { orientation: 'browser-normalized', deskewAngle: 0, regions: results.map((result: OCRRegionResult) => result.region) }
  }, 200, commonHeaders())
})

app.post('/api/games/:id/archive', async c => {
  const row = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>()
  if (!row) return jsonError(c, 'Game not found.', 404)
  if (!c.env.HISTORICAL_API_URL) return jsonError(c, 'Set HISTORICAL_API_URL before sending historical artifacts.', 501)
  const headers: HeadersInit = { 'content-type': 'application/json' }
  if (c.env.HISTORICAL_API_TOKEN) headers.authorization = `Bearer ${c.env.HISTORICAL_API_TOKEN}`
  const response = await fetch(c.env.HISTORICAL_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(rowToGame(row))
  })
  if (!response.ok) return jsonError(c, `Historical API returned ${response.status}.`, 502)
  const archivedAt = new Date().toISOString()
  await c.env.DB.prepare("UPDATE games SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
    .bind(archivedAt, archivedAt, c.req.param('id')).run()
  return c.json({ ok: true, archivedAt }, 200, commonHeaders())
})

app.all('*', async c => c.env.ASSETS.fetch(c.req.raw))

export default app
