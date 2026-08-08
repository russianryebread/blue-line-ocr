<script setup lang="ts">
import type { PipelineStep } from '../services/imagePipeline'

const props = defineProps<{
  previewUrl: string | null
  activeStep: PipelineStep | 'ocr' | null
}>()

const emit = defineEmits<{ cancel: [] }>()

const steps: Array<{ id: PipelineStep | 'ocr'; label: string; detail: string }> = [
  { id: 'orientation', label: 'Orientation', detail: 'Checking the page direction' },
  { id: 'deskew', label: 'Deskew', detail: 'Straightening the form' },
  { id: 'cleanup', label: 'Cleanup', detail: 'Desaturating and boosting contrast' },
  { id: 'segment', label: 'Sections', detail: 'Cutting the known scorecard regions' },
  { id: 'ocr', label: 'OCR', detail: 'Reading each section with AI' }
]

function stateFor(id: PipelineStep | 'ocr') {
  const current = steps.findIndex(step => step.id === props.activeStep)
  const index = steps.findIndex(step => step.id === id)
  if (props.activeStep === 'ocr' && id === 'ocr') return 'active'
  if (current < 0) return ''
  if (index < current) return 'done'
  if (index === current) return 'active'
  return ''
}
</script>

<template>
  <section class="scan-progress-screen">
    <div class="scan-progress-top"><button class="back-button" type="button" @click="emit('cancel')">← Start over</button><span class="eyebrow">READING SCORECARD</span></div>
    <div class="scan-progress-content">
      <div class="processing-preview"><img v-if="previewUrl" :src="previewUrl" alt="Prepared scorecard preview" /><div v-else class="preview-placeholder"><span class="spinner large"></span><p>Preparing preview…</p></div></div>
      <div class="progress-copy"><span class="eyebrow">ONE MOMENT</span><h1>Making the<br /><em>paper legible.</em></h1><p>We clean the photo first, then read small sections instead of asking AI to decipher the whole card at once.</p><div class="progress-list"><div v-for="step in steps" :key="step.id" class="progress-row" :class="`progress-${stateFor(step.id)}`"><span class="progress-icon">{{ stateFor(step.id) === 'done' ? '✓' : stateFor(step.id) === 'active' ? '·' : '○' }}</span><div><strong>{{ step.label }}</strong><small>{{ step.detail }}</small></div><span v-if="stateFor(step.id) === 'active'" class="mini-spinner"></span></div></div></div>
    </div>
  </section>
</template>
