export type TeamSide = 'home' | 'visitor'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface Player {
  number: string
  name: string
}

export interface GoalEvent {
  id: string
  team: TeamSide
  period: string
  time: string
  scorer: string
  assist1: string
  assist2: string
}

export interface PenaltyEvent {
  id: string
  team: TeamSide
  period: string
  time: string
  playerNumber: string
  player: string
  minutes: string
  infraction: string
}

export interface ScoreLine {
  p1: number | null
  p2: number | null
  p3: number | null
  ot: number | null
  total: number | null
}

export interface TeamRecord {
  name: string
  players: Player[]
  goalies: string[]
  timeout: string
}

export interface Scorecard {
  id?: string
  game: {
    date: string
    time: string
    venue: string
    division: string
  }
  officials: {
    referees: string[]
    scorekeeper: string
  }
  home: TeamRecord
  visitor: TeamRecord
  score: {
    home: ScoreLine
    visitor: ScoreLine
  }
  goals: GoalEvent[]
  penalties: PenaltyEvent[]
  notes: string
}

export interface OCRField {
  key: string
  label: string
  value: string
  confidence: number
  source: string
  reviewed: boolean
}

export interface OCRRegionResult {
  region: string
  fields: OCRField[]
  rawText: string
  confidence: number
}

export interface OCRBundle {
  regions: OCRRegionResult[]
  processedAt: string
}

export interface GameSummary {
  id: string
  game_date: string
  game_time: string
  venue: string
  home_team: string
  visitor_team: string
  home_score: number | null
  visitor_score: number | null
  status: string
  updated_at: string
}

export interface SavedGame extends GameSummary {
  scorecard: Scorecard
  ocr?: OCRBundle | null
}

export function createId(prefix = 'evt'): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function blankScoreLine(): ScoreLine {
  return { p1: null, p2: null, p3: null, ot: null, total: null }
}

export function blankTeam(): TeamRecord {
  return {
    name: '',
    players: Array.from({ length: 18 }, () => ({ number: '', name: '' })),
    goalies: ['', ''],
    timeout: ''
  }
}

export function blankScorecard(): Scorecard {
  return {
    game: { date: '', time: '', venue: '', division: '' },
    officials: { referees: ['', ''], scorekeeper: '' },
    home: blankTeam(),
    visitor: blankTeam(),
    score: { home: blankScoreLine(), visitor: blankScoreLine() },
    goals: [],
    penalties: [],
    notes: ''
  }
}

export function scoreTotal(line: ScoreLine): number | null {
  const values = [line.p1, line.p2, line.p3, line.ot].filter(
    (value): value is number => typeof value === 'number'
  )
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.85) return 'high'
  if (value >= 0.65) return 'medium'
  return 'low'
}
