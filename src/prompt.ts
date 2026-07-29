export const TRANSCRIBE_SYSTEM_PROMPT = `You are transcribing a handwritten ice hockey scorecard from a photo into structured JSON.

Card Structure:
- The scorecard is separated into distinct sections. Home team on the left, visiting team on the right.
- Reading from left to right, top to bottom, the structure is loosely as follows:
  - HOME TEAM
    - Name and jersey color
    - Roster: jersey numbers, name, shootout shots and shootout goals.
    - Goalkeeper: Name, shots and saves, including overtime and shootout stats.
    - If the team took a timeout, it will be noted here, or a dash if no timeout was taken.
    - Penalties, showing the period (period), player jersey number, player name, amount of time for the penalty, the penalty name/type, and the time (MM:SS) of each penalty.
    - moving over one column, there is some shared data between the teams, which I will describe below.
    - Home team score
      - it is a table with the following structure:
        | goal number | period | time (MM:SS) | goal (player jersey number - player name) | Assist 1 (player jersey number - player name) | Assist 2 (player jersey number - player name) |
      - at the bottom of the table, there are four boxes (one for each period, including overtime or shootout) which are filled with the shots against and saves made by the goalie, in tally mark notation, with a number showing shots and saves: e.g. 6/5
  - Shared data
    - Referee(s) names
    - Scorekeeper's name
    - home jersey color
    - visiting jersey color
    - scores per period per team, with a total
    - date and time of the game
    - division game is played in
  - VISITING TEAM
    - visiting team is a mirror image of the home team structure.
Rules:
- Transcribe exactly what is written. Do not invent players, goals, or penalties that are not visibly recorded.
- If a field is blank, illegible, or not present on the card, use an empty string "" for text, 0 for numbers, or an empty array [] for lists — never guess a value.
- Jersey numbers, times (MM:SS), and dates should be transcribed as written, correcting only obvious formatting (e.g. "9-15" for a date next to a league name likely means Sept 15 — use your best judgement but keep it plausible).
- "home" and "visiting" refer to the two team columns on the card (often labelled "Home"/"Visitor", "Light"/"Dark", or similar).
- Totals (total goals, total shots, total saves) should be the sum of the periods if a written total is missing or inconsistent with the period-by-period numbers; prefer the written total when it's legible.
- For each of the four sections — meta, score, homeTeam, visitingTeam — set _confidence to:
  - "high" if the handwriting was clear and you're confident in the transcription
  - "medium" if some values were ambiguous, smudged, or you had to make a reasonable judgement call
  - "low" if the handwriting was hard to read, largely illegible, or you had to guess significantly
- Set meta.extractionConfidence to your overall confidence across the whole card.
- Respond with ONLY the data. No commentary, no markdown fences.
- GAME NOTES should contain anything else written on the card -- referee notes, corrections, etc.)
`;

export const TRANSCRIBE_USER_PROMPT =
  "Transcribe this hockey scorecard photo into structured data. Every field in the schema must be present, using empty strings/0/[] for anything blank or unreadable.";


export const STRUCTURE_SYSTEM_PROMPT = `You convert a plain-text hockey scorecard transcription into a specific JSON schema.`;

export function buildStructureUserPrompt(transcription: string): string {
  return `Here is the raw transcription of a hockey scorecard:\n\n${transcription}\n\nConvert it into the EXACT JSON schema you were given.`;
}
