# Rink Record

Rink Record is a fresh Vue + Hono application for turning handwritten hockey scorecards into editable, searchable game records.

## Product flow

1. Capture or upload a scorecard from a phone or desktop.
2. Normalize the image in the browser: orientation, deskew, grayscale/contrast cleanup, and known-region cropping.
3. Send each region to Cloudflare Workers AI separately with a constrained extraction prompt.
4. Review low-confidence fields and edit the digital scorecard.
5. Save the normalized record in D1, reopen it later, print it, export JSON, or send it to a historical archive API.

OCR is intentionally treated as a first draft. The review editor remains the authoritative record.

## Local setup

```bash
npm install
npx wrangler types
npm run check
```

For a full Worker preview with the AI and D1 bindings:

```bash
npm run cf:dev
```

For Cloudflare Builds, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. Or use the repository shortcut locally/through CI:

```bash
npm run deploy
```

The build must run before Wrangler deploys because the Worker serves the Vue client from `dist/client`.

The existing `wrangler.toml` is the canonical deployment configuration. It preserves the `blue-line-ocr` Worker name, the existing `hockey-scorecards` D1 database, its database ID, the `AI` binding, `LOG_LEVEL`, and `VISION_MODEL`.

Apply the compatible migration to the existing database:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

The section OCR pipeline uses the already-configured `VISION_MODEL` environment variable and `AI` Workers AI binding. Its current value is `@cf/meta/llama-3.2-11b-vision-instruct`. Set `HISTORICAL_API_URL` in `wrangler.toml` for the archive handoff and store the token as a Worker secret:

```bash
npx wrangler secret put HISTORICAL_API_TOKEN
```

## Important files

- `src/client/App.vue` — top-level desk, scan, review, save, print, export, and archive workflow.
- `src/client/services/imagePipeline.ts` — browser image normalization and fixed scorecard region definitions.
- `src/client/components/ScorecardEditor.vue` — responsive, editable game record.
- `src/client/components/ConfidencePanel.vue` — OCR confidence review and correction affordances.
- `src/server/ocr.ts` — per-region Workers AI abstraction and scorecard mapping.
- `src/server/index.ts` — Hono API routes, D1 persistence, and historical API delivery.
- `migrations/0001_init.sql` — existing D1 schema retained for migration compatibility.
- `migrations/0002_rink_record.sql` — rebuilt editor fields and backfill.
