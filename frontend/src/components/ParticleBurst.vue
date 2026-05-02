<script setup lang="ts">
import { ref } from "vue";

const particles = ref<{ id: number; x: number; y: number; color: string; delay: number; tx: number; ty: number; size: number; shape: string; rotation: number }[]>([]);
const show = ref(false);

const colors = ["#a78bfa", "#34d399", "#fbbf24", "#60a5fa", "#f87171", "#e879f9", "#818cf8", "#fb923c"];

function fire() {
  show.value = true;
  particles.value = Array.from({ length: 200 }, (_, i) => {
    const fromLeft = i < 100;
    return {
      id: i,
      x: fromLeft ? -1 : 101,
      y: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.4,
      tx: (fromLeft ? 1 : -1) * (60 + Math.random() * 140),
      ty: (Math.random() - 0.5) * 120,
      size: 5 + Math.random() * 10,
      shape: ['circle','square','rect','star'][Math.floor(Math.random() * 4)],
      rotation: Math.random() * 360,
    };
  });
  setTimeout(() => { show.value = false; }, 2800);
}

defineExpose({ fire });
</script>

<template>
  <div v-if="show" class="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
    <div
      v-for="p in particles" :key="p.id"
      :class="['absolute particle-burst', p.shape === 'circle' ? 'rounded-full' : p.shape === 'square' ? 'rounded-sm' : '']"
      :style="{
        left: `${p.x}%`,
        top: `${p.y}%`,
        width: `${p.shape === 'rect' ? p.size * 1.8 : p.size}px`,
        height: `${p.shape === 'rect' ? p.size * 0.6 : p.size}px`,
        borderRadius: p.shape === 'star' ? '2px' : undefined,
        '--rot': `${p.rotation}deg`,
        backgroundColor: p.color,
        '--tx': `${p.tx}px`,
        '--ty': `${p.ty}px`,
        animationDelay: `${p.delay}s`,
      }"
    />
  </div>
</template>

<style scoped>
.particle-burst {
  animation: burst 2.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  opacity: 1;
}

@keyframes burst {
  0% { transform: translate(0, 0) scale(1) rotate(var(--rot, 0deg)); opacity: 1; }
  70% { opacity: 0.8; }
  100% { transform: translate(var(--tx), var(--ty)) scale(0) rotate(calc(var(--rot, 0deg) + 180deg)); opacity: 0; }
}
</style>
