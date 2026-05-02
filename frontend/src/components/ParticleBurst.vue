<script setup lang="ts">
import { ref } from "vue";

const particles = ref<{ id: number; x: number; y: number; color: string; delay: number; angle: number; distance: number; size: number }[]>([]);
const show = ref(false);

const colors = ["#a78bfa", "#34d399", "#fbbf24", "#60a5fa", "#f87171", "#e879f9", "#818cf8", "#fb923c"];

function fire() {
  show.value = true;
  particles.value = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    x: 85 + (Math.random() - 0.5) * 8,
    y: 88 + (Math.random() - 0.5) * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 0.3,
    angle: -45 + (Math.random() - 0.5) * 120,
    distance: 60 + Math.random() * 120,
    size: 4 + Math.random() * 6,
  }));
  setTimeout(() => { show.value = false; }, 1500);
}

defineExpose({ fire });
</script>

<template>
  <div v-if="show" class="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
    <div
      v-for="p in particles" :key="p.id"
      class="absolute rounded-full particle-burst"
      :style="{
        left: `${p.x}%`,
        top: `${p.y}%`,
        width: `${p.size}px`,
        height: `${p.size}px`,
        backgroundColor: p.color,
        '--tx': `${Math.cos(p.angle * Math.PI / 180) * p.distance}px`,
        '--ty': `${Math.sin(p.angle * Math.PI / 180) * p.distance}px`,
        animationDelay: `${p.delay}s`,
      }"
    />
  </div>
</template>

<style scoped>
.particle-burst {
  animation: burst 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  opacity: 1;
}

@keyframes burst {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
}
</style>
