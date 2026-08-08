<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConfidencePanel from './components/ConfidencePanel.vue'
import ScorecardEditor from './components/ScorecardEditor.vue'
import { api } from './services/api'
import { ocrRegionLabel, prepareScan, type PipelineStep } from './services/imagePipeline'
import type { GameSummary, OCRBundle, OCRField, SavedGame, Scorecard } from '@/shared/scorecard'
import { blankScorecard } from '@/shared/scorecard'

type View = 'desk' | 'review'
type ScanStatus = 'idle' | 'preparing' | 'ocr' | 'ready' | 'saving' | 'error'

const view = ref<View>('desk')
const scorecard = ref<Scorecard>(blankScorecard())
const games = ref<GameSummary[]>([])
const ocr = ref<OCRBundle | null>(null)
const sourcePreview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const scanStatus = ref<ScanStatus>('idle')
const pipelineStep = ref<(PipelineStep | 'ocr') | null>(null)
const errorMessage = ref('')
const notice = ref('')
const dirty = ref(false)
const archiveState = ref<'idle' | 'sending' | 'sent'>('idle')

const isBusy = computed(() => ['preparing', 'ocr', 'saving'].includes(scanStatus.value))
const gameTitle = computed(() => {
  const home = scorecard.value.home.name || 'Home team'
  const visitor = scorecard.value.visitor.name || 'Visitor'
  return `${home} vs ${visitor}`
})

const pipelineSteps: Array<{ id: PipelineStep | 'ocr'; label: string }> = [
  { id: 'orientation', label: 'Orientation' },
  { id: 'deskew', label: 'Deskew' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'segment', label: 'Sections' },
  { id: 'ocr', label: 'OCR' }
]

function isStepDone(id: PipelineStep | 'ocr') {
  const current = pipelineSteps.findIndex(step => step.id === (pipelineStep.value || 'orientation'))
  return pipelineSteps.findIndex(step => step.id === id) < current || scanStatus.value === 'ready'
}

function chooseFile() {
  fileInput.value?.click()
}

async function receiveFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await scanFile(file)
}

async function receiveDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file) await scanFile(file)
}

async function scanFile(file: File) {
  if (!file.type.startsWith('image/')) {
    errorMessage.value = 'Choose a JPG, PNG, or HEIC image of the scorecard.'
    scanStatus.value = 'error'
    return
  }
  errorMessage.value = ''
  notice.value = ''
  scanStatus.value = 'preparing'
  pipelineStep.value = 'orientation'
  if (sourcePreview.value) URL.revokeObjectURL(sourcePreview.value)

  try {
    const prepared = await prepareScan(file, step => {
      pipelineStep.value = step
    })
    sourcePreview.value = prepared.previewUrl
    scanStatus.value = 'ocr'
    pipelineStep.value = 'ocr'
    const result = await api.scan(prepared.regions)
    scorecard.value = result.scorecard
    ocr.value = result.ocr
    dirty.value = true
    view.value = 'review'
    scanStatus.value = 'ready'
  } catch (error) {
    scanStatus.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'The scorecard could not be processed.'
  }
}

async function loadGames() {
  try {
    games.value = await api.listGames()
  } catch {
    games.value = []
  }
}

async function openGame(id: string) {
  try {
    const game = await api.getGame(id)
    scorecard.value = game.scorecard
    ocr.value = game.ocr || null
    sourcePreview.value = null
    dirty.value = false
    archiveState.value = game.status === 'archived' ? 'sent' : 'idle'
    view.value = 'review'
    notice.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'That game could not be opened.'
  }
}

function newScorecard() {
  scorecard.value = blankScorecard()
  ocr.value = null
  sourcePreview.value = null
  dirty.value = false
  archiveState.value = 'idle'
  scanStatus.value = 'idle'
  view.value = 'review'
}

async function save() {
  scanStatus.value = 'saving'
  errorMessage.value = ''
  try {
    const result = await api.saveGame(scorecard.value, ocr.value)
    scorecard.value = result.scorecard
    dirty.value = false
    scanStatus.value = 'ready'
    notice.value = 'Saved to your game desk.'
    await loadGames()
  } catch (error) {
    scanStatus.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'The game could not be saved.'
  }
}

function printScorecard() {
  window.print()
}

function exportJson() {
  const blob = new Blob([JSON.stringify(scorecard.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${gameTitle.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function archive() {
  if (!scorecard.value.id) {
    errorMessage.value = 'Save the game before sending it to the historical archive.'
    return
  }
  archiveState.value = 'sending'
  try {
    await api.archiveGame(scorecard.value.id)
    archiveState.value = 'sent'
    notice.value = 'Sent to the historical archive.'
    await loadGames()
  } catch (error) {
    archiveState.value = 'idle'
    errorMessage.value = error instanceof Error ? error.message : 'The archive handoff failed.'
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor: Record<string, unknown> | unknown[] = target
  tokens.slice(0, -1).forEach((token, index) => {
    const next = tokens[index + 1]
    if (Array.isArray(cursor)) {
      const position = Number(token)
      if (!cursor[position]) cursor[position] = /^\d+$/.test(next) ? [] : {}
      cursor = cursor[position] as Record<string, unknown> | unknown[]
    } else {
      if (!cursor[token]) cursor[token] = /^\d+$/.test(next) ? [] : {}
      cursor = cursor[token] as Record<string, unknown> | unknown[]
    }
  })
  const last = tokens[tokens.length - 1]
  if (Array.isArray(cursor)) cursor[Number(last)] = value
  else cursor[last] = value
}

function updateOCRField(field: OCRField) {
  const numeric = Number(field.value.replace(/[^0-9-]/g, ''))
  const value: unknown = /\.p[123]|\.ot|\.total$/.test(field.key) && field.value.trim() !== '' && Number.isFinite(numeric)
    ? numeric
    : field.value
  setPath(scorecard.value as unknown as Record<string, unknown>, field.key, value)
  dirty.value = true
}

function scorecardChanged() {
  dirty.value = true
  notice.value = ''
}

onMounted(loadGames)
onUnmounted(() => {
  if (sourcePreview.value) URL.revokeObjectURL(sourcePreview.value)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="view = 'desk'"><span class="brand-mark">RR</span><span><strong>Rink Record</strong><small>paper → archive</small></span></button>
      <div class="topbar-center"><span class="live-dot"></span> Local game desk <span class="slash">/</span> {{ view === 'desk' ? 'Inbox' : 'Scorecard editor' }}</div>
      <button class="new-button" type="button" @click="newScorecard"><span>＋</span> New game</button>
    </header>

    <main class="main-content">
      <div v-if="errorMessage" class="toast toast-error"><span>!</span>{{ errorMessage }}<button type="button" @click="errorMessage = ''">×</button></div>
      <div v-if="notice" class="toast toast-success"><span>✓</span>{{ notice }}<button type="button" @click="notice = ''">×</button></div>

      <section v-if="view === 'desk'" class="desk-view">
        <div class="intro-row"><div><span class="eyebrow">GAME DESK · {{ games.length }} SAVED</span><h1>Make the paper<br /><em>make sense.</em></h1><p>Turn a handwritten hockey scorecard into a clean, editable game record.</p></div><div class="intro-note"><span class="note-line"></span><span>Built for the one person who still has to read the handwriting.</span></div></div>
        <div class="desk-grid">
          <button class="dropzone" type="button" @click="chooseFile" @dragover.prevent @drop.prevent="receiveDrop">
            <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" capture="environment" @change="receiveFile" />
            <div class="dropzone-art"><span class="corner corner-tl"></span><span class="corner corner-tr"></span><span class="corner corner-bl"></span><span class="corner corner-br"></span><div class="scan-icon"><span></span><span></span><span></span></div></div>
            <span class="dropzone-label">Scan a scorecard</span><span class="dropzone-sub">Take a photo or choose an image<br />JPG · PNG · camera photo</span><span class="dropzone-action">Open camera / files <b>↗</b></span>
          </button>
          <div class="desk-side"><div class="workflow-card"><span class="eyebrow">THE HANDOFF</span><h2>Five quiet steps<br />to a better record.</h2><ol><li><span>01</span><b>Clean the image</b><small>Orientation, skew, grayscale</small></li><li><span>02</span><b>Split the form</b><small>Known sections, less noise</small></li><li><span>03</span><b>Read each section</b><small>AI OCR with confidence</small></li><li><span>04</span><b>Correct the record</b><small>You stay in control</small></li><li><span>05</span><b>Save or send</b><small>D1 + your archive API</small></li></ol></div></div>
        </div>
        <section class="recent-section"><div class="section-heading-row"><div><span class="eyebrow">MEMORY</span><h2>Recent games</h2></div><button v-if="games.length" class="text-button" type="button" @click="loadGames">Refresh ↻</button></div><div v-if="games.length" class="recent-grid"><button v-for="game in games" :key="game.id" class="recent-card" type="button" @click="openGame(game.id)"><span class="recent-date">{{ game.game_date || 'Undated' }} · {{ game.game_time || 'time unknown' }}</span><strong>{{ game.home_team || 'Home team' }}</strong><span class="versus">vs</span><strong>{{ game.visitor_team || 'Visitor' }}</strong><span class="recent-meta"><span>{{ game.home_score ?? '—' }} — {{ game.visitor_score ?? '—' }}</span><span :class="`status status-${game.status}`">{{ game.status }}</span></span></button></div><div v-else class="memory-empty"><span class="empty-orbit">◌</span><div><strong>Your game memory is empty.</strong><p>Save a scorecard and it will live here, ready to reopen, print, or send onward.</p></div></div></section>
      </section>

      <section v-else class="review-view">
        <div class="review-header"><div><button class="back-button" type="button" @click="view = 'desk'">← Game desk</button><span class="eyebrow">SCORECARD EDITOR <span v-if="dirty" class="dirty-mark">· unsaved</span></span><h1>{{ gameTitle }}</h1></div><div class="review-actions"><button class="quiet-button" type="button" @click="exportJson">Export JSON</button><button class="quiet-button" type="button" @click="printScorecard">Print</button><button class="primary-button" type="button" :disabled="isBusy" @click="save">{{ scanStatus === 'saving' ? 'Saving…' : 'Save game' }}</button></div></div>
        <div class="review-layout">
          <aside class="source-column"><div class="source-card"><div class="source-card-head"><div><span class="eyebrow">SOURCE IMAGE</span><h3>What the camera saw</h3></div><span v-if="ocr" class="source-confidence">{{ ocrRegionLabel(ocr) }}% readable</span></div><div class="source-frame"><img v-if="sourcePreview" :src="sourcePreview" alt="Normalized scorecard source" /><div v-else class="no-source"><span>▧</span><p>This game was opened from memory.<br />The original image was not stored.</p></div></div><div class="source-caption"><span class="status-dot"></span>{{ ocr ? 'Normalized + sectioned in browser' : 'Manual record' }}</div></div><ConfidencePanel :bundle="ocr" @update="updateOCRField" /></aside>
          <div class="editor-column"><div v-if="scanStatus === 'preparing' || scanStatus === 'ocr'" class="processing-banner"><span class="spinner"></span><div><strong>{{ scanStatus === 'ocr' ? 'Reading each scorecard section…' : 'Preparing your scorecard…' }}</strong><small>{{ pipelineStep ? pipelineSteps.find(step => step.id === pipelineStep)?.label : 'Starting' }} in progress</small></div><div class="mini-progress"><i v-for="step in pipelineSteps" :key="step.id" :class="{ active: pipelineStep === step.id, done: isStepDone(step.id) }"></i></div></div><ScorecardEditor v-model="scorecard" @change="scorecardChanged" /><div class="mobile-actions"><button class="quiet-button" type="button" @click="printScorecard">Print</button><button class="primary-button" type="button" @click="save">Save game</button></div><div class="archive-strip"><div><span class="eyebrow">HISTORICAL ARTIFACT</span><strong>Finished editing?</strong><p>Send this normalized game record to the archive API when you are ready.</p></div><button class="archive-button" type="button" :disabled="archiveState === 'sending' || archiveState === 'sent'" @click="archive">{{ archiveState === 'sent' ? '✓ Sent to archive' : archiveState === 'sending' ? 'Sending…' : 'Send game ↗' }}</button></div></div>
        </div>
      </section>
    </main>
    <footer class="footer"><span>RINK RECORD / PRIVATE GAME DESK</span><span>OCR IS A FIRST DRAFT · YOU ARE THE OFFICIAL SCORER</span></footer>
  </div>
</template>
