<script setup lang="ts">
import { computed } from 'vue'
import type { Scorecard, TeamSide } from '@/shared/scorecard'
import { createId, scoreTotal } from '@/shared/scorecard'

const props = defineProps<{ modelValue: Scorecard }>()
const emit = defineEmits<{ change: []; 'update:modelValue': [Scorecard] }>()

const card = computed(() => props.modelValue)
const periods = ['p1', 'p2', 'p3', 'ot'] as const

function changed() {
  emit('change')
  emit('update:modelValue', card.value)
}

function addGoal() {
  card.value.goals.push({ id: createId('goal'), team: 'home', period: '1', time: '', scorer: '', assist1: '', assist2: '' })
  changed()
}

function removeGoal(index: number) {
  card.value.goals.splice(index, 1)
  changed()
}

function addPenalty() {
  card.value.penalties.push({ id: createId('pen'), team: 'home', period: '1', time: '', playerNumber: '', player: '', minutes: '2', infraction: '' })
  changed()
}

function removePenalty(index: number) {
  card.value.penalties.splice(index, 1)
  changed()
}

function team(side: TeamSide) {
  return card.value[side]
}

function teamLabel(side: TeamSide) {
  return side === 'home' ? 'Home team' : 'Visitor'
}
</script>

<template>
  <div class="scorecard-sheet">
    <section class="sheet-section sheet-header-section">
      <div class="section-kicker"><span>01</span> Game identity</div>
      <div class="identity-grid">
        <label class="field"><span>Date</span><input v-model="card.game.date" type="date" @change="changed" /></label>
        <label class="field"><span>Start time</span><input v-model="card.game.time" type="time" @change="changed" /></label>
        <label class="field field-wide"><span>Venue / rink</span><input v-model="card.game.venue" placeholder="North rink · sheet 2" @change="changed" /></label>
        <label class="field"><span>Division</span><input v-model="card.game.division" placeholder="U18 · rec" @change="changed" /></label>
      </div>
    </section>

    <section class="sheet-section score-banner">
      <div class="score-team">
        <span class="team-eyebrow">HOME</span>
        <input v-model="card.home.name" class="team-name-input" placeholder="Home team" @change="changed" />
      </div>
      <div class="score-total">
        <strong>{{ scoreTotal(card.score.home) ?? '—' }}</strong><span>FINAL</span><strong>{{ scoreTotal(card.score.visitor) ?? '—' }}</strong>
      </div>
      <div class="score-team score-team-right">
        <span class="team-eyebrow">VISITOR</span>
        <input v-model="card.visitor.name" class="team-name-input" placeholder="Visitor" @change="changed" />
      </div>
      <div class="period-score-grid">
        <div></div><span v-for="period in periods" :key="period">{{ period.toUpperCase() }}</span><div>TOTAL</div>
        <template v-for="side in (['home', 'visitor'] as TeamSide[])" :key="side">
          <span class="score-side-label">{{ side === 'home' ? 'H' : 'V' }}</span>
          <input v-for="period in periods" :key="`${side}-${period}`" v-model.number="card.score[side][period]" type="number" min="0" inputmode="numeric" @change="changed" />
          <output>{{ scoreTotal(card.score[side]) ?? '—' }}</output>
        </template>
      </div>
    </section>

    <section class="sheet-section">
      <div class="section-kicker"><span>02</span> Rosters</div>
      <div class="roster-columns">
        <div v-for="side in (['home', 'visitor'] as TeamSide[])" :key="side" class="roster-block">
          <div class="subsection-heading"><span>{{ teamLabel(side) }}</span><small>{{ team(side).players.filter(player => player.name || player.number).length }} players</small></div>
          <div class="roster-head"><span>#</span><span>Player name</span></div>
          <div v-for="(player, index) in team(side).players" :key="`${side}-${index}`" class="roster-row">
            <input v-model="player.number" aria-label="Jersey number" placeholder="—" @change="changed" />
            <input v-model="player.name" aria-label="Player name" placeholder="Player name" @change="changed" />
          </div>
          <div class="goalie-row">
            <span class="row-label">Goalies</span>
            <input v-for="(_, index) in team(side).goalies" :key="index" v-model="team(side).goalies[index]" placeholder="Name" @change="changed" />
          </div>
          <label class="field timeout-field"><span>Timeout / notes</span><input v-model="team(side).timeout" placeholder="—" @change="changed" /></label>
        </div>
      </div>
    </section>

    <section class="sheet-section">
      <div class="section-heading-row"><div class="section-kicker"><span>03</span> Goals</div><button class="text-button" type="button" @click="addGoal">+ Add goal</button></div>
      <div v-if="card.goals.length" class="event-table-wrap">
        <table class="event-table"><thead><tr><th>Team</th><th>Period</th><th>Time</th><th>Scorer</th><th>Assist 1</th><th>Assist 2</th><th></th></tr></thead>
          <tbody><tr v-for="(goal, index) in card.goals" :key="goal.id"><td><select v-model="goal.team" @change="changed"><option value="home">Home</option><option value="visitor">Visitor</option></select></td><td><select v-model="goal.period" @change="changed"><option>1</option><option>2</option><option>3</option><option>OT</option></select></td><td><input v-model="goal.time" placeholder="12:34" @change="changed" /></td><td><input v-model="goal.scorer" placeholder="Scorer" @change="changed" /></td><td><input v-model="goal.assist1" placeholder="Assist" @change="changed" /></td><td><input v-model="goal.assist2" placeholder="Assist" @change="changed" /></td><td><button class="icon-button" type="button" aria-label="Remove goal" @click="removeGoal(index)">×</button></td></tr></tbody>
        </table>
      </div>
      <div v-else class="empty-table">No scoring events captured yet. Add a goal or correct one from the review panel.</div>
    </section>

    <section class="sheet-section">
      <div class="section-heading-row"><div class="section-kicker"><span>04</span> Penalties</div><button class="text-button" type="button" @click="addPenalty">+ Add penalty</button></div>
      <div v-if="card.penalties.length" class="event-table-wrap">
        <table class="event-table"><thead><tr><th>Team</th><th>P</th><th>Time</th><th>#</th><th>Player</th><th>Min</th><th>Infraction</th><th></th></tr></thead>
          <tbody><tr v-for="(penalty, index) in card.penalties" :key="penalty.id"><td><select v-model="penalty.team" @change="changed"><option value="home">Home</option><option value="visitor">Visitor</option></select></td><td><input v-model="penalty.period" placeholder="1" @change="changed" /></td><td><input v-model="penalty.time" placeholder="12:34" @change="changed" /></td><td><input v-model="penalty.playerNumber" placeholder="#" @change="changed" /></td><td><input v-model="penalty.player" placeholder="Player" @change="changed" /></td><td><input v-model="penalty.minutes" placeholder="2" @change="changed" /></td><td><input v-model="penalty.infraction" placeholder="Tripping" @change="changed" /></td><td><button class="icon-button" type="button" aria-label="Remove penalty" @click="removePenalty(index)">×</button></td></tr></tbody>
        </table>
      </div>
      <div v-else class="empty-table">No penalties captured yet.</div>
    </section>

    <section class="sheet-section notes-section">
      <div class="section-kicker"><span>05</span> Closing notes</div>
      <textarea v-model="card.notes" rows="4" placeholder="Anything the archive should know about this game?" @change="changed"></textarea>
      <div class="officials-grid"><label class="field"><span>Referee 1</span><input v-model="card.officials.referees[0]" placeholder="Name" @change="changed" /></label><label class="field"><span>Referee 2</span><input v-model="card.officials.referees[1]" placeholder="Name" @change="changed" /></label><label class="field"><span>Scorekeeper</span><input v-model="card.officials.scorekeeper" placeholder="Name" @change="changed" /></label></div>
    </section>
  </div>
</template>
