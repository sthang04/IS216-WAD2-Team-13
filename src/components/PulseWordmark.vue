<script setup>
// "PULSE" wordmark in Archivo Expanded Black.
// Size it with font-size on the component (everything is in em).
</script>

<template>
  <span class="pulse-wordmark" role="img" aria-label="Pulse">
    <span aria-hidden="true">PULSE</span>
  </span>
</template>

<style scoped>
.pulse-wordmark {
  display: inline-block;
  color: var(--pulse-primary, #e11d48);
  font-family: 'Archivo', 'Arial Black', sans-serif;
  font-weight: 900;
  font-stretch: 125%;
  letter-spacing: -0.02em;
  line-height: 0.82;
  text-transform: uppercase;
  user-select: none;
}
</style>
