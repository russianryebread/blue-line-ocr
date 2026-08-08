import type { GameSummary, OCRBundle, SavedGame, Scorecard } from '@/shared/scorecard'
import type { ScanCalibration } from '@/shared/calibration'

export interface ScanResponse {
  scorecard: Scorecard
  ocr: OCRBundle
  diagnostics: {
    orientation: string
    deskewAngle: number
    regions: string[]
  }
}

export interface AppConfig {
  debug: boolean
  calibration?: ScanCalibration
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Request failed with status ${response.status}.`)
  }
  return response.json() as Promise<T>
}

export const api = {
  getConfig: () => request<AppConfig>('/api/config'),
  saveCalibration: (calibration: ScanCalibration) => request<{ calibration: ScanCalibration }>('/api/debug/calibration', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ calibration })
  }),
  listGames: () => request<GameSummary[]>('/api/games'),
  getGame: (id: string) => request<SavedGame>(`/api/games/${encodeURIComponent(id)}`),
  saveGame: (scorecard: Scorecard, ocr?: OCRBundle | null) => request<SavedGame>(
    scorecard.id ? `/api/games/${encodeURIComponent(scorecard.id)}` : '/api/games',
    {
      method: scorecard.id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scorecard, ocr })
    }
  ),
  archiveGame: (id: string) => request<{ ok: boolean; archivedAt: string }>(
    `/api/games/${encodeURIComponent(id)}/archive`, { method: 'POST' }
  ),
  scan: (regions: Record<string, Blob>) => {
    const form = new FormData()
    Object.entries(regions).forEach(([name, blob]) => form.append(name, blob, `${name}.jpg`))
    return request<ScanResponse>('/api/scan', { method: 'POST', body: form })
  }
}
