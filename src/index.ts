import { Hono } from "hono";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from "./prompt";
import { scorecardJsonSchema, type ExtractionResult, type Scorecard } from "./schema";
import OpenAI from "openai";

export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: Fetcher;
  readonly LOG_LEVEL: string;
  readonly VISION_MODEL: string;
  readonly MOONSHOT_API_KEY: string;
}
const VISION_MODEL_DEFAULT = "kimi-k3";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — plenty for a phone photo, keeps the AI call fast

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /api/extract — accepts a photo, returns the scorecard as structured
// JSON (with per-section confidence) for the review UI to render/edit.
// ---------------------------------------------------------------------------
app.post("/api/extract", async (c) => {
  const form = await c.req.parseBody();
  const file = form["image"];

  if (!(file instanceof File)) {
    return c.json({ error: "Expected a multipart form with an 'image' file field." }, 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: `Image too large. Max size is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "File must be an image." }, 400);
  }

  const buffer = await file.arrayBuffer();
  const dataUrl = `data:${file.type};base64,${arrayBufferToBase64(buffer)}`;

  // Default to Moonshot's vision model (or set via environment variable MOONSHOT_MODEL)
  const visionModel = c.env.VISION_MODEL ?? VISION_MODEL_DEFAULT;

  console.log(`Using vision model: ${visionModel}`);

  const openai = new OpenAI({
      apiKey: c.env.MOONSHOT_API_KEY,
      baseURL: "https://api.moonshot.cn/v1",
    });

  let aiResponse: OpenAI.Chat.Completions.ChatCompletion;
  try {
    aiResponse = await openai.chat.completions.create({
      model: visionModel,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_USER_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scorecard",
          strict: true,
          schema: scorecardJsonSchema
        },
      },
      max_tokens: 15000,
      temperature: 0.2,
    });
  } catch (err: any) {
    console.error("AI Model API call failed", err);
    return c.json({ error: "The AI model call failed.", detail: String(err?.message ?? err) }, 502);
  }

  if (c.env.LOG_LEVEL === "debug") {
    console.log("aiResponse", aiResponse);
  }

  const content = aiResponse.choices[0]?.message?.content;
  if (!content) {
    return c.json({ error: "The model didn't return any content." }, 502);
  }

  try {
    const extracted = JSON.parse(content);
    return c.json(extracted);
  } catch (err) {
    console.error("Failed to parse output JSON", content);
    return c.json({ error: "Failed to parse model response into JSON." }, 502);
  }
});

// ---------------------------------------------------------------------------
// POST /api/games — save a (user-reviewed/corrected) scorecard to D1.
// ---------------------------------------------------------------------------
app.post("/api/games", async (c) => {
  const body = await c.req.json<Scorecard>().catch(() => null);
  if (!body || !body.meta || !body.score || !body.homeTeam || !body.visitingTeam) {
    return c.json({ error: "Request body doesn't look like a scorecard." }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO games
      (id, game_date, league, division, home_team, visiting_team, home_score, visiting_score, extraction_confidence, data)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(
      id,
      body.meta.date || null,
      body.meta.league || null,
      body.meta.division || null,
      body.homeTeam.name || null,
      body.visitingTeam.name || null,
      body.score.home?.total ?? null,
      body.score.visiting?.total ?? null,
      body.meta.extractionConfidence || null,
      JSON.stringify(body)
    )
    .run();

  return c.json({ id }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/games — list historic records (summary columns only).
// ---------------------------------------------------------------------------
app.get("/api/games", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, game_date, league, division, home_team, visiting_team,
            home_score, visiting_score, extraction_confidence
     FROM games
     ORDER BY created_at DESC
     LIMIT 200`
  ).all();

  return c.json({ games: results });
});

// ---------------------------------------------------------------------------
// GET /api/games/:id — full saved scorecard JSON.
// ---------------------------------------------------------------------------
app.get("/api/games/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT data FROM games WHERE id = ?1`)
    .bind(c.req.param("id"))
    .first<{ data: string }>();

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.body(row.data, 200, { "content-type": "application/json" });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Workers AI's JSON Mode returns the parsed object at `aiResponse.response`.
 * If the model (or a future model swap) ever returns it as a raw string
 * instead, fall back to parsing it ourselves rather than failing outright.
 */
function coerceExtractionResult(aiResponse: any): ExtractionResult | null {
  const candidate = aiResponse?.response ?? aiResponse;
  if (candidate && typeof candidate === "object" && candidate.meta && candidate.homeTeam) {
    return candidate as ExtractionResult;
  }
  if (typeof candidate === "string") {
    try {
      const parsed = JSON.parse(stripCodeFence(candidate));
      if (parsed?.meta && parsed?.homeTeam) return parsed as ExtractionResult;
    } catch {
      // fall through
    }
  }
  return null;
}

function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : text.trim();
}
