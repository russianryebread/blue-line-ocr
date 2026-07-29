// ---------------------------------------------------------------------------
// Tiny vanilla-JS app. No build step — this file is served as-is by Workers
// static assets. `state` holds the current extraction result (including the
// UI-only `_confidence` block); every input is bound to a dot/bracket path
// into `state` via getPath/setPath.
// ---------------------------------------------------------------------------

let state = null; // ExtractionResult | null

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---- Tabs -------------------------------------------------------------

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $(`#view-${tab.dataset.view}`).classList.add("active");
    if (tab.dataset.view === "history") loadHistory();
  });
});

// ---- Path get/set helpers ----------------------------------------------

function pathTokens(path) {
  return path.match(/[^.[\]]+/g) || [];
}
function getPath(obj, path) {
  return pathTokens(path).reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}
function setPath(obj, path, value) {
  const tokens = pathTokens(path);
  const last = tokens.pop();
  const target = tokens.reduce((cur, key) => (cur[key] ??= {}), obj);
  target[last] = value;
}

// ---- Upload / capture ----------------------------------------------------

let selectedFile = null;

$("#image-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  const url = URL.createObjectURL(file);
  const preview = $("#preview");
  preview.src = url;
  preview.hidden = false;
  $("#extract-btn").hidden = false;
  hideError();
});

$("#extract-btn").addEventListener("click", async () => {
  if (!selectedFile) return;
  hideError();
  $("#review").hidden = true;
  $("#loading").hidden = false;
  $("#extract-btn").hidden = true;

  // display a random loading message rotating through them every 3 seconds
  const messages = [
    "Reading the scorecard...",
    "Extracting data...",
    "Analyzing...",
    "Processing...",
  ];
  let i = 0;
  const interval = setInterval(() => {
    $("#loading-message").textContent = messages[i];
    i = (i + 1) % messages.length;
  }, 5000);

  try {
    const form = new FormData();
    form.append("image", selectedFile);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Extraction failed.");
    state = body;
    renderReview();
    $("#review").hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    $("#loading").hidden = true;
    $("#extract-btn").hidden = false;
    clearInterval(interval);
  }
});

$("#reset-btn").addEventListener("click", () => {
  state = null;
  selectedFile = null;
  $("#image-input").value = "";
  $("#preview").hidden = true;
  $("#extract-btn").hidden = true;
  $("#review").hidden = true;
  $("#save-status").textContent = "";
  hideError();
});

function showError(msg) {
  const el = $("#error-banner");
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $("#error-banner").hidden = true;
}

// ---- Review rendering ------------------------------------------------

function confBadge(level) {
  const lvl = level || "medium";
  return `<span class="badge conf-${lvl}">${lvl}</span>`;
}

function field(label, path, opts = {}) {
  const value = getPath(state, path);
  const type = opts.type || "text";
  const displayValue = value ?? (type === "number" ? 0 : "");
  return `
    <div>
      <label class="field">${label}</label>
      <input type="${type}" data-path="${path}" value="${escapeAttr(displayValue)}" ${
    opts.step ? `step="${opts.step}"` : ""
  } />
    </div>`;
}

function escapeAttr(v) {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderReview() {
  const c = state._confidence || {};
  const html = `
    ${renderMetaSection(c.meta)}
    ${renderScoreSection(c.score)}
    ${renderTeamSection("homeTeam", "Home Team", c.homeTeam)}
    ${renderTeamSection("visitingTeam", "Visiting Team", c.visitingTeam)}
    <div class="section">
      <div class="section-title"><h3>Game Notes</h3></div>
      <textarea data-path="gameNotes">${escapeHtml(state.gameNotes || "")}</textarea>
    </div>
  `;
  $("#review-body").innerHTML = html;
  bindInputs();
  bindRowButtons();
}

function renderMetaSection(conf) {
  return `
    <div class="section conf-${conf}">
      <div class="section-title"><h3>Game Info</h3>${confBadge(conf)}</div>
      <div class="field-grid">
        ${field("League", "meta.league")}
        ${field("Division", "meta.division")}
        ${field("Date", "meta.date")}
        ${field("Game Time", "meta.gameTime")}
        ${field("Scorekeeper", "meta.scorekeeper")}
        ${field("Referees (comma-separated)", "meta.referees_csv")}
      </div>
    </div>`;
}

function renderScoreSection(conf) {
  const periodFields = (team) => `
      <div class="field-grid">
        ${field("P1", `score.${team}.period1`, { type: "number" })}
        ${field("P2", `score.${team}.period2`, { type: "number" })}
        ${field("P3", `score.${team}.period3`, { type: "number" })}
        ${field("OT", `score.${team}.ot`, { type: "number" })}
        ${field("Total", `score.${team}.total`, { type: "number" })}
      </div>`;
  return `
    <div class="section conf-${conf}">
      <div class="section-title"><h3>Score</h3>${confBadge(conf)}</div>
      <div class="subhead">Home (${escapeHtml(state.homeTeam?.name || "")})</div>
      ${periodFields("home")}
      <div class="subhead">Visiting (${escapeHtml(state.visitingTeam?.name || "")})</div>
      ${periodFields("visiting")}
    </div>`;
}

function renderTeamSection(teamKey, label, conf) {
  const team = state[teamKey];
  return `
    <div class="section conf-${conf}">
      <div class="section-title"><h3>${label}</h3>${confBadge(conf)}</div>
      ${field("Team Name", `${teamKey}.name`)}

      <div class="subhead">Players</div>
      <div class="row-list" data-list="${teamKey}.players">
        ${team.players.map((p, i) => playerRow(teamKey, i)).join("")}
      </div>
      <button class="add-row-btn" data-add="${teamKey}.players" data-template="player">+ Add player</button>

      <div class="subhead">Goals</div>
      <div class="row-list" data-list="${teamKey}.goals">
        ${team.goals.map((g, i) => goalRow(teamKey, i)).join("")}
      </div>
      <button class="add-row-btn" data-add="${teamKey}.goals" data-template="goal">+ Add goal</button>

      <div class="subhead">Penalties</div>
      <div class="row-list" data-list="${teamKey}.penalties">
        ${team.penalties.map((p, i) => penaltyRow(teamKey, i)).join("")}
      </div>
      <button class="add-row-btn" data-add="${teamKey}.penalties" data-template="penalty">+ Add penalty</button>

      <div class="subhead">Goalkeeper</div>
      <div class="field-grid wide">${field("Name", `${teamKey}.goalkeeper.name`)}</div>
      <div class="field-grid">
        ${field("SA P1", `${teamKey}.goalkeeper.shotsAgainstByPeriod.p1`, { type: "number" })}
        ${field("SA P2", `${teamKey}.goalkeeper.shotsAgainstByPeriod.p2`, { type: "number" })}
        ${field("SA P3", `${teamKey}.goalkeeper.shotsAgainstByPeriod.p3`, { type: "number" })}
        ${field("SA OT", `${teamKey}.goalkeeper.shotsAgainstByPeriod.ot`, { type: "number" })}
        ${field("SA Total", `${teamKey}.goalkeeper.shotsAgainstByPeriod.total`, { type: "number" })}
        ${field("Saves P1", `${teamKey}.goalkeeper.savesByPeriod.p1`, { type: "number" })}
        ${field("Saves P2", `${teamKey}.goalkeeper.savesByPeriod.p2`, { type: "number" })}
        ${field("Saves P3", `${teamKey}.goalkeeper.savesByPeriod.p3`, { type: "number" })}
        ${field("Saves OT", `${teamKey}.goalkeeper.savesByPeriod.ot`, { type: "number" })}
        ${field("Saves Total", `${teamKey}.goalkeeper.savesByPeriod.total`, { type: "number" })}
      </div>

      <div class="field-grid wide">${field("Timeouts", `${teamKey}.timeouts`, { type: "number" })}</div>

      <div class="subhead">Shootout</div>
      <div class="row-list" data-list="${teamKey}.shootout">
        ${team.shootout.map((s, i) => shootoutRow(teamKey, i)).join("")}
      </div>
      <button class="add-row-btn" data-add="${teamKey}.shootout" data-template="shootout">+ Add attempt</button>
    </div>`;
}

function playerRow(teamKey, i) {
  const base = `${teamKey}.players[${i}]`;
  return `<div class="row-item">
    <button class="remove-row" data-remove="${teamKey}.players" data-index="${i}">✕</button>
    <div class="field-grid">
      ${field("#", `${base}.number`, { type: "number" })}
      ${field("Name", `${base}.name`)}
    </div>
  </div>`;
}

function goalRow(teamKey, i) {
  const base = `${teamKey}.goals[${i}]`;
  return `<div class="row-item">
    <button class="remove-row" data-remove="${teamKey}.goals" data-index="${i}">✕</button>
    <div class="field-grid">
      ${field("Period", `${base}.period`, { type: "number" })}
      ${field("Time", `${base}.time`)}
      ${field("Scorer #", `${base}.scorerNumber`, { type: "number" })}
      ${field("Assist 1 #", `${base}.assist1Number`, { type: "number" })}
      ${field("Assist 2 #", `${base}.assist2Number`, { type: "number" })}
    </div>
  </div>`;
}

function penaltyRow(teamKey, i) {
  const base = `${teamKey}.penalties[${i}]`;
  return `<div class="row-item">
    <button class="remove-row" data-remove="${teamKey}.penalties" data-index="${i}">✕</button>
    <div class="field-grid">
      ${field("Period", `${base}.period`, { type: "number" })}
      ${field("Player #", `${base}.playerNumber`, { type: "number" })}
      ${field("Player Name", `${base}.playerName`)}
      ${field("Minutes", `${base}.minutes`, { type: "number" })}
      ${field("Start Time", `${base}.startTime`)}
      ${field("Offense", `${base}.offense`)}
    </div>
  </div>`;
}

function shootoutRow(teamKey, i) {
  const base = `${teamKey}.shootout[${i}]`;
  const scored = !!getPath(state, `${base}.scored`);
  return `<div class="row-item">
    <button class="remove-row" data-remove="${teamKey}.shootout" data-index="${i}">✕</button>
    <div class="field-grid">
      ${field("Player #", `${base}.playerNumber`, { type: "number" })}
      <div>
        <label class="field">Scored</label>
        <select data-path="${base}.scored" data-bool="true">
          <option value="true" ${scored ? "selected" : ""}>Yes</option>
          <option value="false" ${!scored ? "selected" : ""}>No</option>
        </select>
      </div>
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- Event binding -----------------------------------------------------

function bindInputs() {
  // Special-case: referees is an array in state but edited as CSV text.
  const refereesInput = $('[data-path="meta.referees_csv"]');
  if (refereesInput) refereesInput.value = (state.meta.referees || []).join(", ");

  $$("#review-body [data-path]").forEach((el) => {
    el.addEventListener("input", () => onFieldChange(el));
    el.addEventListener("change", () => onFieldChange(el));
  });
}

function onFieldChange(el) {
  const path = el.dataset.path;
  if (path === "meta.referees_csv") {
    state.meta.referees = el.value.split(",").map((s) => s.trim()).filter(Boolean);
    return;
  }
  let value = el.value;
  if (el.dataset.bool) value = value === "true";
  else if (el.type === "number") value = value === "" ? 0 : Number(value);
  setPath(state, path, value);
}

function bindRowButtons() {
  $$("#review-body [data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const listPath = btn.dataset.add;
      const arr = getPath(state, listPath);
      arr.push(templateFor(btn.dataset.template));
      renderReview();
    });
  });
  $$("#review-body [data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const arr = getPath(state, btn.dataset.remove);
      arr.splice(Number(btn.dataset.index), 1);
      renderReview();
    });
  });
}

function templateFor(kind) {
  switch (kind) {
    case "player":
      return { number: 0, name: "" };
    case "goal":
      return { period: 1, time: "", scorerNumber: 0, assist1Number: 0, assist2Number: 0 };
    case "penalty":
      return { period: 1, playerNumber: 0, playerName: "", minutes: 0, offense: "", startTime: "" };
    case "shootout":
      return { playerNumber: 0, scored: false };
    default:
      return {};
  }
}

// ---- Save / download -----------------------------------------------------

function scorecardWithoutConfidence() {
  const { _confidence, ...scorecard } = state;
  return scorecard;
}

$("#save-btn").addEventListener("click", async () => {
  const status = $("#save-status");
  status.textContent = "Saving…";
  try {
    const res = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scorecardWithoutConfidence()),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Save failed.");
    status.textContent = "Saved to history ✓";
  } catch (err) {
    status.textContent = "";
    showError(err.message || String(err));
  }
});

$("#download-btn").addEventListener("click", () => {
  const data = scorecardWithoutConfidence();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const teams = `${data.homeTeam?.name || "home"}_vs_${data.visitingTeam?.name || "visiting"}`;
  a.href = url;
  a.download = `${(data.meta?.date || "scorecard")}_${teams}.json`.replace(/\s+/g, "_");
  a.click();
  URL.revokeObjectURL(url);
});

// ---- History -----------------------------------------------------------

async function loadHistory() {
  const container = $("#history-list");
  container.innerHTML = `<p class="hint">Loading…</p>`;
  try {
    const res = await fetch("/api/games");
    const body = await res.json();
    if (!body.games || body.games.length === 0) {
      container.innerHTML = `<p class="hint">No saved games yet.</p>`;
      return;
    }
    container.innerHTML = body.games
      .map(
        (g) => `
      <div class="history-item" data-id="${g.id}">
        <div>
          <div class="teams">${escapeHtml(g.home_team || "Home")} vs ${escapeHtml(g.visiting_team || "Visiting")}</div>
          <div class="meta-line">${escapeHtml(g.game_date || "")} · ${escapeHtml(g.league || "")} ${
          g.division ? "· " + escapeHtml(g.division) : ""
        }</div>
        </div>
        <div class="score">${g.home_score ?? "–"} : ${g.visiting_score ?? "–"}</div>
      </div>`
      )
      .join("");

    $$(".history-item").forEach((item) => {
      item.addEventListener("click", () => showGameDetail(item.dataset.id));
    });
  } catch (err) {
    container.innerHTML = `<p class="hint">Failed to load history.</p>`;
  }
}

async function showGameDetail(id) {
  const container = $("#history-list");
  const res = await fetch(`/api/games/${id}`);
  const data = await res.json();
  container.innerHTML = `
    <button class="text-btn" id="back-to-list">&larr; Back to list</button>
    <pre class="json-view">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  `;
  $("#back-to-list").addEventListener("click", loadHistory);
}
