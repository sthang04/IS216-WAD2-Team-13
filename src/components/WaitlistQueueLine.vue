<script setup>
// One booking's waitlist drawn as a line, front on the left.
// Each CCA swipes in from the back when the queue opens.

const props = defineProps({
  queue: { type: Array, required: true },
  activeClubId: { type: Number, default: null }
})

function isYou(row) {
  return row.club_id === props.activeClubId
}

</script>

<template>
  <div class="pulse-queue-wrap">
    <TransitionGroup tag="ol" name="pulse-q" appear class="pulse-queue small">
      <li
        v-for="(row, i) in queue"
        :key="row.entry_id"
        class="pulse-queue-spot"
        :class="{ 'is-you': isYou(row), 'is-offered': row.status === 'OFFERED' }"
        :style="{ '--i': i }"
        :aria-current="isYou(row) ? 'true' : undefined"
      >
        <span class="pulse-queue-num">{{ i + 1 }}</span>
        <span>
          <strong>{{ row.club_name }}</strong><span v-if="isYou(row)" class="pulse-you">you</span>
          <span class="d-block pulse-queue-state">{{ row.status === 'OFFERED' ? 'Holding offer' : 'Waiting' }}</span>
        </span>
      </li>
    </TransitionGroup>
  </div>
</template>
