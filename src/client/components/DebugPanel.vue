<script setup lang="ts">
import type { PipelineArtifact } from '../services/imagePipeline'
import type { ScanCalibration } from '@/shared/calibration'

defineProps<{
  calibration: ScanCalibration | null
  artifacts: PipelineArtifact[]
  saving: boolean
}>()

const emit = defineEmits<{ save: []; reset: [] }>()
</script>

<template>
  <section class="debug-panel">
    <div class="debug-panel-heading"><div><span class="eyebrow">DEBUG MODE</span><h2>See the scan pipeline</h2><p>Every image below is an input to the next step. Adjust the map, then save it as the next default.</p></div><span class="debug-live">ENV ON</span></div>
    <div v-if="artifacts.length" class="artifact-grid"><figure v-for="artifact in artifacts" :key="artifact.id" class="artifact-card"><div class="artifact-image"><img :src="artifact.url" :alt="artifact.label" /></div><figcaption><strong>{{ artifact.label }}</strong><small>{{ artifact.detail }}</small></figcaption></figure></div><div v-else class="debug-empty">Run a scan to populate the intermediate images.</div>
    <div v-if="calibration" class="calibration-editor"><div class="calibration-title"><div><span class="eyebrow">CALIBRATION MAP</span><h3>Crop regions</h3></div><span class="calibration-version">v{{ calibration.version }}</span></div><div class="preprocess-controls"><label><span>Max px</span><input v-model.number="calibration.preprocessing.maxDimension" type="number" min="1000" max="5000" step="100" /></label><label><span>Contrast</span><input v-model.number="calibration.preprocessing.contrast" type="number" min="0.8" max="2.2" step="0.05" /></label></div><div class="calibration-list"><div v-for="(region, key) in calibration.regions" :key="key" class="calibration-row"><div class="calibration-label"><strong>{{ region.label }}</strong><small>{{ key }}</small></div><label><span>X</span><input v-model.number="region.x" type="number" min="0" max="1" step="0.005" /></label><label><span>Y</span><input v-model.number="region.y" type="number" min="0" max="1" step="0.005" /></label><label><span>W</span><input v-model.number="region.width" type="number" min="0.02" max="1" step="0.005" /></label><label><span>H</span><input v-model.number="region.height" type="number" min="0.02" max="1" step="0.005" /></label></div></div><div class="debug-actions"><button class="quiet-button" type="button" @click="emit('reset')">Reset defaults</button><button class="primary-button" type="button" :disabled="saving" @click="emit('save')">{{ saving ? 'Saving…' : 'Save calibration' }}</button></div></div>
  </section>
</template>
