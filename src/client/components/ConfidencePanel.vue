<script setup lang="ts">
import { computed } from 'vue'
import type { OCRBundle, OCRField } from '@/shared/scorecard'
import { confidenceLevel } from '@/shared/scorecard'

const props = defineProps<{ bundle: OCRBundle | null }>()
const emit = defineEmits<{ update: [field: OCRField] }>()
const fields = computed(() => props.bundle?.regions.flatMap(region => region.fields) ?? [])
const flagged = computed(() => fields.value.filter(field => field.confidence < 0.75 && !field.reviewed))

function change(field: OCRField) {
  field.reviewed = true
  emit('update', field)
}
</script>

<template>
  <aside class="confidence-panel">
    <div class="panel-title-row"><div><span class="eyebrow">OCR REVIEW</span><h3>Check the uncertain bits</h3></div><span class="confidence-count">{{ flagged.length }} open</span></div>
    <p class="panel-intro">The machine filled what it could. Give these fields a quick look before you save.</p>
    <div v-if="flagged.length" class="confidence-list">
      <div v-for="field in flagged" :key="field.key" class="confidence-item" :class="`confidence-${confidenceLevel(field.confidence)}`">
        <div class="confidence-item-top"><span>{{ field.label }}</span><strong>{{ Math.round(field.confidence * 100) }}%</strong></div>
        <input v-model="field.value" :aria-label="field.label" @change="change(field)" />
        <small>{{ field.source }} · tap to confirm</small>
      </div>
    </div>
    <div v-else class="confidence-clear"><span>✓</span><div><strong>Nothing flagged</strong><p>All captured fields are either high-confidence or reviewed.</p></div></div>
    <div class="confidence-legend"><span><i class="dot dot-high"></i> High</span><span><i class="dot dot-medium"></i> Review</span><span><i class="dot dot-low"></i> Needs attention</span></div>
  </aside>
</template>
