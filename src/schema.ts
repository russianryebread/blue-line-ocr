// ---------------------------------------------------------------------------
// The scorecard shape the app extracts, edits, saves, and exports.
// This mirrors the schema you provided exactly. The only addition is
// `_confidence`, which is UI-only metadata the model attaches per section so
// the review screen can flag fields worth double-checking. `_confidence` is
// stripped before saving to D1 or downloading, so the exported JSON always
// matches your schema byte-for-byte.
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "low" | "medium" | "high";

export interface PeriodScore {
  period1: number;
  period2: number;
  period3: number;
  ot: number;
  total: number;
}

export interface Player {
  number: number;
  name: string;
}

export interface Goal {
  period: number;
  time: string;
  scorerNumber: number;
  assist1Number: number;
  assist2Number: number;
}

export interface Penalty {
  period: number;
  playerNumber: number;
  playerName: string;
  minutes: number;
  offense: string;
  startTime: string;
}

export interface PeriodTally {
  p1: number;
  p2: number;
  p3: number;
  ot: number;
  total: number;
}

export interface Goalkeeper {
  name: string;
  shotsAgainstByPeriod: PeriodTally;
  savesByPeriod: PeriodTally;
}

export interface ShootoutAttempt {
  playerNumber: number;
  scored: boolean;
}

export interface Team {
  name: string;
  players: Player[];
  goals: Goal[];
  penalties: Penalty[];
  goalkeeper: Goalkeeper;
  timeouts: number;
  shootout: ShootoutAttempt[];
}

export interface ScorecardMeta {
  league: string;
  date: string;
  gameTime: string;
  division: string;
  referees: string[];
  scorekeeper: string;
  extractionConfidence: ConfidenceLevel;
}

export interface Scorecard {
  meta: ScorecardMeta;
  score: {
    home: PeriodScore;
    visiting: PeriodScore;
  };
  homeTeam: Team;
  visitingTeam: Team;
  gameNotes: string;
}

// Section-level confidence the model reports back for the review UI.
export interface SectionConfidence {
  meta: ConfidenceLevel;
  score: ConfidenceLevel;
  homeTeam: ConfidenceLevel;
  visitingTeam: ConfidenceLevel;
}

// What /api/extract returns: the scorecard plus the UI-only confidence map.
export interface ExtractionResult extends Scorecard {
  _confidence: SectionConfidence;
}

export function stripConfidence(result: ExtractionResult): Scorecard {
  const { _confidence, ...scorecard } = result;
  return scorecard;
}

// ---------------------------------------------------------------------------
// JSON Schema handed to Workers AI's response_format (JSON Mode), so the
// vision model's output is constrained to this exact shape instead of us
// having to hope it returns clean JSON. See:
// https://developers.cloudflare.com/workers-ai/features/json-mode/
// ---------------------------------------------------------------------------

const periodScoreSchema = {
  type: "object",
  properties: {
    period1: { type: "number" },
    period2: { type: "number" },
    period3: { type: "number" },
    ot: { type: "number" },
    total: { type: "number" },
  },
  required: ["period1", "period2", "period3", "ot", "total"],
};

const periodTallySchema = {
  type: "object",
  properties: {
    p1: { type: "number" },
    p2: { type: "number" },
    p3: { type: "number" },
    ot: { type: "number" },
    total: { type: "number" },
  },
  required: ["p1", "p2", "p3", "ot", "total"],
};

const teamSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "number" },
          name: { type: "string" },
        },
        required: ["number", "name"],
      },
    },
    goals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          period: { type: "number" },
          time: { type: "string" },
          scorerNumber: { type: "number" },
          assist1Number: { type: "number" },
          assist2Number: { type: "number" },
        },
        required: ["period", "time", "scorerNumber"],
      },
    },
    penalties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          period: { type: "number" },
          playerNumber: { type: "number" },
          playerName: { type: "string" },
          minutes: { type: "number" },
          offense: { type: "string" },
          startTime: { type: "string" },
        },
        required: ["period", "playerNumber", "minutes", "offense"],
      },
    },
    goalkeeper: {
      type: "object",
      properties: {
        name: { type: "string" },
        shotsAgainstByPeriod: periodTallySchema,
        savesByPeriod: periodTallySchema,
      },
      required: ["name", "shotsAgainstByPeriod", "savesByPeriod"],
    },
    timeouts: { type: "number" },
    shootout: {
      type: "array",
      items: {
        type: "object",
        properties: {
          playerNumber: { type: "number" },
          scored: { type: "boolean" },
        },
        required: ["playerNumber", "scored"],
      },
    },
  },
  required: ["name", "players", "goals", "penalties", "goalkeeper", "timeouts", "shootout"],
};

const confidenceEnum = { type: "string", enum: ["low", "medium", "high"] };

export const scorecardJsonSchema = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      properties: {
        league: { type: "string" },
        date: { type: "string" },
        gameTime: { type: "string" },
        division: { type: "string" },
        referees: { type: "array", items: { type: "string" } },
        scorekeeper: { type: "string" },
        extractionConfidence: confidenceEnum,
      },
      required: ["league", "date", "gameTime", "division", "referees", "scorekeeper", "extractionConfidence"],
    },
    score: {
      type: "object",
      properties: {
        home: periodScoreSchema,
        visiting: periodScoreSchema,
      },
      required: ["home", "visiting"],
    },
    homeTeam: teamSchema,
    visitingTeam: teamSchema,
    gameNotes: { type: "string" },
    _confidence: {
      type: "object",
      description:
        "Your own confidence, per section, in how accurately you read the handwriting there.",
      properties: {
        meta: confidenceEnum,
        score: confidenceEnum,
        homeTeam: confidenceEnum,
        visitingTeam: confidenceEnum,
      },
      required: ["meta", "score", "homeTeam", "visitingTeam"],
    },
  },
  required: ["meta", "score", "homeTeam", "visitingTeam", "gameNotes", "_confidence"],
} as const;
