// ---------------------------------------------------------------------------
// Two-step extraction pipeline. In testing, the vision model would ignore
// response_format / json_schema when the message content included an image
// and just return free-text prose -- so we don't rely on it to produce JSON
// directly. Instead:
//
//   Step 1 (vision model): read the photo, write out everything on the card
//   in a plain labelled-text format, using our exact field names, flagging
//   anything illegible as UNCLEAR rather than guessing.
//
//   Step 2 (text model, JSON Mode): take that transcription and convert it
//   into the exact JSON schema, with confidence based on how much of the
//   transcription was clean vs. flagged/missing.
// ---------------------------------------------------------------------------

export const TRANSCRIBE_SYSTEM_PROMPT = `You are transcribing a handwritten ice hockey scorecard from a photo. Read every field on the card carefully and write out what you see as plain labelled text -- not JSON.

Use exactly this structure and these labels, one per line. If a field is blank or genuinely not on the card, write "BLANK". If it's present but you can't read it confidently, write "UNCLEAR" and your best guess in parentheses, e.g. "UNCLEAR (maybe 14)".

LEAGUE:
DIVISION:
DATE:
GAME TIME:
SCOREKEEPER:
REFEREES: (comma-separated)

HOME TEAM NAME:
HOME SCORE PERIOD 1:
HOME SCORE PERIOD 2:
HOME SCORE PERIOD 3:
HOME SCORE OT:
HOME SCORE TOTAL:
HOME PLAYERS: (list as "#<number> <name>", one per line)
HOME GOALS: (list as "P<period> <MM:SS> scorer #<n>, assist1 #<n>, assist2 #<n>", one per line, blank fields as "-")
HOME PENALTIES: (list as "P<period> player #<n> <name>, <minutes>min, <offense>, start <MM:SS>", one per line)
HOME GOALKEEPER NAME:
HOME GOALKEEPER JERSEY #:
HOME SHOTS AGAINST BY PERIOD: (P1, P2, P3, OT, Total)
HOME SAVES BY PERIOD: (P1, P2, P3, OT, Total)
HOME TIMEOUTS:
HOME SHOOTOUT: (list as "#<n> scored/missed", one per line, or BLANK)

VISITING TEAM NAME:
VISITING SCORE PERIOD 1:
VISITING SCORE PERIOD 2:
VISITING SCORE PERIOD 3:
VISITING SCORE OT:
VISITING SCORE TOTAL:
VISITING PLAYERS:
VISITING GOALS:
VISITING PENALTIES:
VISITING GOALKEEPER NAME:
VISITING GOALKEEPER JERSEY #:
VISITING SHOTS AGAINST BY PERIOD:
VISITING SAVES BY PERIOD:
VISITING TIMEOUTS:
VISITING SHOOTOUT:

GAME NOTES: (anything else written on the card -- referee notes, corrections, etc.)

Do not invent players, goals, or penalties that aren't visibly recorded. Do not add commentary or explanation outside this format.`;

export const TRANSCRIBE_USER_PROMPT =
  "Transcribe this hockey scorecard photo using the exact label format you were given.";

export const STRUCTURE_SYSTEM_PROMPT = `You convert a plain-text hockey scorecard transcription into a specific JSON schema.

Rules:
- Map every labelled value in the transcription to the matching schema field. "home"/"visiting" map to homeTeam/visitingTeam.
- Where the transcription says "BLANK", use "" for text fields, 0 for numbers, or [] for lists.
- Where the transcription says "UNCLEAR (guess)", use the guess as the value, but this should push that section's confidence down.
- Totals: if a period-by-period breakdown is present but the written total is BLANK or clearly wrong, compute the total as the sum of the periods.
- For each of the four sections -- meta, score, homeTeam, visitingTeam -- set _confidence based on how much of that section's source text was clean vs. UNCLEAR/BLANK:
  - "high": all or nearly all values were clean
  - "medium": a few values were UNCLEAR or guessed
  - "low": many values were UNCLEAR, BLANK where data was expected, or guessed
- Set meta.extractionConfidence to your overall confidence across the whole card.
- Output ONLY the JSON object matching the schema -- no commentary, no markdown fences.`;

export function buildStructureUserPrompt(transcription: string): string {
  return `Here is the raw transcription of a hockey scorecard:\n\n${transcription}\n\nConvert it into the JSON schema you were given.`;
}
