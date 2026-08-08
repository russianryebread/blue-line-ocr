export interface CalibrationRegion {
  label: string
  x: number
  y: number
  width: number
  height: number
  hint: string
}

export interface ScanCalibration {
  id: string
  version: number
  preprocessing: {
    maxDimension: number
    contrast: number
  }
  regions: Record<string, CalibrationRegion>
  updatedAt?: string
}

export const DEFAULT_CALIBRATION: ScanCalibration = {
  id: 'default',
  version: 2,
  preprocessing: {
    maxDimension: 2600,
    contrast: 1.22
  },
  regions: {
    header: {
      label: 'Header and officials', x: 0.03, y: 0.04, width: 0.94, height: 0.26,
      hint: 'Extract team names, date, time, division, referees, and scorekeeper from the top of the sheet.'
    },
    homeRoster: {
      label: 'Home roster', x: 0.05, y: 0.19, width: 0.22, height: 0.39,
      hint: 'Extract player jersey numbers and names.'
    },
    visitorRoster: {
      label: 'Visitor roster', x: 0.73, y: 0.19, width: 0.22, height: 0.39,
      hint: 'Extract player jersey numbers and names.'
    },
    scoring: {
      label: 'Score summary', x: 0.34, y: 0.18, width: 0.32, height: 0.18,
      hint: 'Extract home and visitor period scores, overtime, and totals.'
    },
    goalsHome: {
      label: 'Home goal events', x: 0.27, y: 0.30, width: 0.22, height: 0.27,
      hint: 'Extract home scoring events: period, time, goal scorer, and assists.'
    },
    goalsVisitor: {
      label: 'Visitor goal events', x: 0.51, y: 0.30, width: 0.22, height: 0.27,
      hint: 'Extract visitor scoring events: period, time, goal scorer, and assists.'
    },
    homeGoalie: {
      label: 'Home goalie', x: 0.07, y: 0.51, width: 0.20, height: 0.14,
      hint: 'Extract the home goalie name and visible period shots and saves.'
    },
    visitorGoalie: {
      label: 'Visitor goalie', x: 0.74, y: 0.51, width: 0.19, height: 0.14,
      hint: 'Extract the visitor goalie name and visible period shots and saves.'
    },
    homePenaltiesA: {
      label: 'Home penalties A', x: 0.07, y: 0.70, width: 0.20, height: 0.18,
      hint: 'Extract home penalties: period, player number, player, minutes, infraction, and start time.'
    },
    homePenaltiesB: {
      label: 'Home penalties B', x: 0.28, y: 0.70, width: 0.20, height: 0.18,
      hint: 'Extract home penalties: period, player number, player, minutes, infraction, and start time.'
    },
    visitorPenaltiesA: {
      label: 'Visitor penalties A', x: 0.51, y: 0.70, width: 0.20, height: 0.18,
      hint: 'Extract visitor penalties: period, player number, player, minutes, infraction, and start time.'
    },
    visitorPenaltiesB: {
      label: 'Visitor penalties B', x: 0.73, y: 0.70, width: 0.20, height: 0.18,
      hint: 'Extract visitor penalties: period, player number, player, minutes, infraction, and start time.'
    },
    notes: {
      label: 'Game notes', x: 0.04, y: 0.89, width: 0.92, height: 0.09,
      hint: 'Extract handwritten notes at the bottom of the scoresheet.'
    }
  }
}

export function cloneCalibration(calibration: ScanCalibration): ScanCalibration {
  return JSON.parse(JSON.stringify(calibration)) as ScanCalibration
}
