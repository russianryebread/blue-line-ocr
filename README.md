# Hockey Scorecard Scanner

A single Cloudflare Worker that:
1. Serves a mobile-friendly page to photograph/upload a scorecard (`public/`)
2. Sends the image to Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`) constrained to your JSON schema via [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)
3. Renders the result as an editable form, with a colored badge per section (Game Info / Score / Home Team / Visiting Team) showing the model's own confidence — low/medium/high
4. Lets you download the corrected JSON, and/or save it to D1 as a historic record
5. Has a History tab that lists and re-displays saved games from D1

## Project layout

```
src/index.ts       Hono app — /api/extract, /api/games (POST + GET), /api/games/:id
src/schema.ts       TS types + the JSON Schema handed to the model
src/prompt.ts       System/user prompt for the vision model
public/             Static frontend (plain HTML/CSS/JS, no build step)
migrations/          D1 schema
wrangler.toml
```

## Setup

```bash
npm install

# Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create hockey-scorecards

# Apply the schema
npm run db:init:local     # for `wrangler dev`
npm run db:init:remote    # for production

# Local dev
npm run dev

# Deploy
npm run deploy
```

The vision model requires a one-time License/Acceptable-Use acceptance on your account. If `/api/extract` errors on first use, run:

```bash
curl https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
  -H "Authorization: Bearer $CLOUDFLARE_AUTH_TOKEN" \
  -d '{ "prompt": "agree"}'
```

## Design notes / assumptions made

- **Schema**: matches the JSON structure you provided exactly. The only addition is a UI-only `_confidence` object (`meta`/`score`/`homeTeam`/`visitingTeam`, each `"low"|"medium"|"high"`) that the model fills in alongside the data. It's stripped out before saving to D1 or downloading, so both outputs are byte-for-byte your schema.
- **Player names**: kept free-text (not a fixed roster/dropdown) per your answer, so this works for any team/league without setup.
- **No image storage**: only the extracted/corrected JSON is persisted to D1, not the photo itself. If you want the original image kept for audit purposes, that's a small addition (R2 bucket + a column storing the key) — say the word and I'll add it.
- **D1 row**: stores the full JSON blob in `data`, plus a few flattened columns (date, teams, score, league) purely so the History list can query/sort without parsing JSON per row.
- **Frontend**: plain HTML/CSS/JS with no build step, so `wrangler dev`/`deploy` is all you need — no bundler config. If you'd rather have this as Vue (matching your usual frontend stack), it's a straightforward port; I kept it framework-free here since Workers' static-assets binding serves it with zero extra tooling.

## One thing worth verifying on first deploy

Cloudflare's own docs/code samples for `llama-3.2-11b-vision-instruct` have had inconsistencies between the `messages` (OpenAI-style, with `image_url` content) and the older `{ image: [...bytes], prompt }` input formats — there's an open documentation issue about it. I used the `messages` + `image_url` + `response_format: json_schema` combination, which is the pattern documented for both vision input and JSON Mode individually. If `/api/extract` throws on your account, the fallback is switching `src/index.ts` to the classic `{ image: Array.from(new Uint8Array(buffer)), prompt: "..." }` shape — I can make that change immediately if you hit it.
