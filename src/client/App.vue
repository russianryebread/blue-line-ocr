<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConfidencePanel from './components/ConfidencePanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import ScanProgress from './components/ScanProgress.vue'
import ScorecardEditor from './components/ScorecardEditor.vue'
import { api } from './services/api'
import { inspectScan, orientationPreview, prepareScan, type PipelineArtifact, type PipelineStep, type ScanInspection } from './services/imagePipeline'
import { cloneCalibration, DEFAULT_CALIBRATION, type ScanCalibration } from '@/shared/calibration'
import type { GameSummary, OCRBundle, OCRField, SavedGame, Scorecard } from '@/shared/scorecard'
import { blankScorecard } from '@/shared/scorecard'

type View = 'capture' | 'orientation' | 'processing' | 'review'
type ScanStatus = 'idle' | 'orientation' | 'preparing' | 'ocr' | 'ready' | 'saving' | 'error'

const view = ref<View>('capture')
const scorecard = ref<Scorecard>(blankScorecard())
const games = ref<GameSummary[]>([])
const ocr = ref<OCRBundle | null>(null)
const sourcePreview = ref<string | null>(null)
const orientationPreviewUrl = ref<string | null>(null)
const inspection = ref<ScanInspection | null>(null)
const rotation = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)
const scanStatus = ref<ScanStatus>('idle')
const pipelineStep = ref<(PipelineStep | 'ocr') | null>(null)
const errorMessage = ref('')
const notice = ref('')
const dirty = ref(false)
const archiveState = ref<'idle' | 'sending' | 'sent'>('idle')
const debugEnabled = ref(false)
const calibration = ref<ScanCalibration>(cloneCalibration(DEFAULT_CALIBRATION))
const artifacts = ref<PipelineArtifact[]>([])
const savingCalibration = ref(false)

const gameTitle = computed(() => `${scorecard.value.home.name || 'Home team'} vs ${scorecard.value.visitor.name || 'Visitor'}`)
const isBusy = computed(() => ['preparing', 'ocr', 'saving'].includes(scanStatus.value))

function chooseFile() {
  fileInput.value?.click()
}

async function receiveFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await beginScan(file)
}

async function receiveDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file) await beginScan(file)
}

async function beginScan(file: File) {
  if (!file.type.startsWith('image/')) {
    errorMessage.value = 'Choose a JPG, PNG, or camera photo of the scorecard.'
    scanStatus.value = 'error'
    return
  }
  errorMessage.value = ''
  notice.value = ''
  clearScanArtifacts()
  try {
    inspection.value = await inspectScan(file)
    orientationPreviewUrl.value = inspection.value.originalPreviewUrl
    if (debugEnabled.value) {
      artifacts.value.push({ id: 'original', label: 'Original', url: inspection.value.originalPreviewUrl, detail: `${inspection.value.orientation} source image` })
    }
    rotation.value = 0
    scanStatus.value = 'orientation'
    view.value = 'orientation'
  } catch (error) {
    scanStatus.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'The image could not be opened.'
  }
}

async function changeRotation(delta: number) {
  if (!inspection.value) return
  const nextAngle = (rotation.value + delta + 360) % 360
  const nextPreview = await orientationPreview(inspection.value.source, nextAngle)
  cleanupPreview(orientationPreviewUrl, inspection.value.originalPreviewUrl)
  rotation.value = nextAngle
  orientationPreviewUrl.value = nextAngle === 0 ? inspection.value.originalPreviewUrl : nextPreview
  if (nextAngle === 0) URL.revokeObjectURL(nextPreview)
}

async function processScan() {
  if (!inspection.value) return
  errorMessage.value = ''
  view.value = 'processing'
  scanStatus.value = 'preparing'
  pipelineStep.value = 'deskew'
  try {
    const prepared = await prepareScan(inspection.value, rotation.value, calibration.value, step => {
      pipelineStep.value = step
    }, artifact => {
      if (debugEnabled.value) artifacts.value.push(artifact)
    })
    cleanupPreview(sourcePreview)
    sourcePreview.value = prepared.previewUrl
    scanStatus.value = 'ocr'
    pipelineStep.value = 'ocr'
    const result = await api.scan(prepared.regions)
    scorecard.value = result.scorecard
    ocr.value = result.ocr
    dirty.value = true
    scanStatus.value = 'ready'
    view.value = 'review'
  } catch (error) {
    scanStatus.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'The scorecard could not be processed.'
    view.value = 'capture'
  }
}

function cancelScan() {
  clearScanArtifacts()
  inspection.value = null
  rotation.value = 0
  scanStatus.value = 'idle'
  pipelineStep.value = null
  view.value = 'capture'
}

function cleanupPreview(value: { value: string | null }, keep?: string) {
  if (value.value && value.value !== keep) URL.revokeObjectURL(value.value)
  value.value = null
}

function clearScanArtifacts() {
  const urls = new Set<string>()
  artifacts.value.forEach(artifact => urls.add(artifact.url))
  if (orientationPreviewUrl.value) urls.add(orientationPreviewUrl.value)
  if (sourcePreview.value) urls.add(sourcePreview.value)
  urls.forEach(url => URL.revokeObjectURL(url))
  artifacts.value = []
  orientationPreviewUrl.value = null
  sourcePreview.value = null
}

async function loadConfig() {
  try {
    const config = await api.getConfig()
    debugEnabled.value = config.debug
    if (config.calibration) calibration.value = config.calibration
  } catch {
    debugEnabled.value = false
  }
}

async function saveCalibration() {
  if (!debugEnabled.value) return
  savingCalibration.value = true
  try {
    const result = await api.saveCalibration(calibration.value)
    calibration.value = result.calibration
    notice.value = 'Calibration saved for future scans.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Calibration could not be saved.'
  } finally {
    savingCalibration.value = false
  }
}

function resetCalibration() {
  calibration.value = cloneCalibration(DEFAULT_CALIBRATION)
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
    const game: SavedGame = await api.getGame(id)
    scorecard.value = game.scorecard
    ocr.value = game.ocr || null
    clearScanArtifacts()
    inspection.value = null
    dirty.value = false
    archiveState.value = game.status === 'archived' ? 'sent' : 'idle'
    view.value = 'review'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'That game could not be opened.'
  }
}

function newGame() {
  cancelScan()
  scorecard.value = blankScorecard()
  ocr.value = null
  dirty.value = false
  archiveState.value = 'idle'
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
  const value: unknown = /\.p[123]|\.ot|\.total$/.test(field.key) && field.value.trim() !== '' && Number.isFinite(numeric) ? numeric : field.value
  setPath(scorecard.value as unknown as Record<string, unknown>, field.key, value)
  dirty.value = true
}

function scorecardChanged() {
  dirty.value = true
  notice.value = ''
}

onMounted(() => {
  void loadGames()
  void loadConfig()
})
onUnmounted(() => {
  clearScanArtifacts()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="view = 'capture'"><span class="brand-mark">RR</span><span><strong>Rink Record</strong><small>paper → archive</small></span></button>
      <button v-if="view === 'review'" class="new-button" type="button" @click="newGame">New scan</button>
    </header>

    <main class="main-content">
      <div v-if="errorMessage" class="toast toast-error"><span>!</span>{{ errorMessage }}<button type="button" @click="errorMessage = ''">×</button></div>
      <div v-if="notice" class="toast toast-success"><span>✓</span>{{ notice }}<button type="button" @click="notice = ''">×</button></div>

      <section v-if="view === 'capture'" class="capture-page">
        <div class="capture-heading"><span class="eyebrow">RINK RECORD</span><h1>Scan the<br /><em>scorecard.</em></h1><p>Take a clear photo or choose one from your phone. We’ll make it readable and ready to edit.</p></div>
        <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" capture="environment" @change="receiveFile" />
        <button class="camera-button" type="button" @click="chooseFile" @dragover.prevent @drop.prevent="receiveDrop"><span class="camera-glyph"><i></i></span><strong>Take a picture</strong><small>or choose a photo from this device</small></button>
        <button class="upload-button" type="button" @click="chooseFile">Choose an upload <span>↗</span></button>
        <div class="capture-tip"><span>◎</span><p>Fit all four corners in the frame.<br />A flat, well-lit card reads best.</p></div>
        <details v-if="games.length" class="recent-drawer"><summary>Open a saved game <span>{{ games.length }}</span></summary><div class="recent-list"><button v-for="game in games" :key="game.id" type="button" @click="openGame(game.id)"><span>{{ game.game_date || 'Undated' }}</span><strong>{{ game.home_team || 'Home' }} <i>vs</i> {{ game.visitor_team || 'Visitor' }}</strong><small>{{ game.home_score ?? '—' }} — {{ game.visitor_score ?? '—' }}</small></button></div></details>
      </section>

      <section v-else-if="view === 'orientation'" class="orientation-page">
        <div class="orientation-heading"><button class="back-button" type="button" @click="cancelScan">← Start over</button><span class="eyebrow">STEP 1 OF 2 · ORIENTATION CHECK</span><h1>Is the top<br /><em>up?</em></h1><p>Rotate the preview until the scorecard reads naturally. OCR starts only after you confirm.</p></div>
        <div class="orientation-card"><img v-if="orientationPreviewUrl" :src="orientationPreviewUrl" alt="Scorecard orientation preview" /><div class="rotation-controls"><button type="button" aria-label="Rotate left" @click="changeRotation(-90)">↶</button><span>{{ rotation }}°</span><button type="button" aria-label="Rotate right" @click="changeRotation(90)">↷</button></div></div>
        <button class="primary-button continue-button" type="button" @click="processScan">Looks right — clean this image <span>→</span></button>
      </section>

      <div v-else-if="view === 'processing'" class="processing-view"><ScanProgress :preview-url="sourcePreview || orientationPreviewUrl" :active-step="pipelineStep" @cancel="cancelScan" /><DebugPanel v-if="debugEnabled" :calibration="calibration" :artifacts="artifacts" :saving="savingCalibration" @save="saveCalibration" @reset="resetCalibration" /></div>

      <section v-else class="review-view">
        <div class="review-header"><div><button class="back-button" type="button" @click="view = 'capture'">← New scan</button><span class="eyebrow">SCORECARD EDITOR <span v-if="dirty" class="dirty-mark">· unsaved</span></span><h1>{{ gameTitle }}</h1></div><div class="review-actions"><button class="quiet-button" type="button" @click="exportJson">Export JSON</button><button class="quiet-button" type="button" @click="printScorecard">Print</button><button class="primary-button" type="button" :disabled="isBusy" @click="save">{{ scanStatus === 'saving' ? 'Saving…' : 'Save game' }}</button></div></div>
        <div class="review-layout"><aside class="source-column"><div class="source-card"><div class="source-card-head"><div><span class="eyebrow">PREPARED PREVIEW</span><h3>Cleaned source image</h3></div></div><div class="source-frame"><img v-if="sourcePreview" :src="sourcePreview" alt="Rotated, cleaned scorecard source" /><div v-else class="no-source"><span>▧</span><p>The original image was not stored<br />for this saved game.</p></div></div><div class="source-caption"><span class="status-dot"></span>Rotated · deskewed · desaturated</div></div><ConfidencePanel :bundle="ocr" @update="updateOCRField" /></aside><div class="editor-column"><ScorecardEditor v-model="scorecard" @change="scorecardChanged" /><div class="mobile-actions"><button class="quiet-button" type="button" @click="printScorecard">Print</button><button class="primary-button" type="button" @click="save">Save game</button></div><div class="archive-strip"><div><span class="eyebrow">HISTORICAL ARTIFACT</span><strong>Finished editing?</strong><p>Send this normalized game record to the archive API when ready.</p></div><button class="archive-button" type="button" :disabled="archiveState === 'sending' || archiveState === 'sent'" @click="archive">{{ archiveState === 'sent' ? '✓ Sent to archive' : archiveState === 'sending' ? 'Sending…' : 'Send game ↗' }}</button></div><DebugPanel v-if="debugEnabled" :calibration="calibration" :artifacts="artifacts" :saving="savingCalibration" @save="saveCalibration" @reset="resetCalibration" /></div></div>
      </section>
    </main>
    <footer class="footer"><span>RINK RECORD / PRIVATE GAME DESK</span><span>OCR IS A FIRST DRAFT · YOU ARE THE OFFICIAL SCORER</span></footer>
  </div>
</template>
