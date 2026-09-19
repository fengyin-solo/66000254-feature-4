<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent
} from 'echarts/components';
import { useCanBusStore } from '../store/canbus';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent]);

const store = useCanBusStore();
const chartRef = ref<InstanceType<typeof VChart> | null>(null);

// 超过该间隔没有新点，曲线断开（不拿旧值连成直线）
const GAP_MS = 1000;
// 超过该间隔没有新点，当前读数标记为"停更"
const STALE_MS = 1500;

// 每个信号名固定分配一个颜色，保证曲线、图例、读数、挑选器颜色一致
const PALETTE = [
  '#06b6d4', '#22c55e', '#ef4444', '#eab308', '#a855f7',
  '#f97316', '#3b82f6', '#ec4899', '#14b8a6', '#a3e635'
];

function colorOf(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

// 与列表页一致的单位展示（优先常用单位表，回退 DBC 定义）
const FALLBACK_UNITS: Record<string, string> = {
  EngineRPM: 'rpm',
  VehicleSpeed: 'km/h',
  CoolantTemp: '°C',
  ThrottlePosition: '%',
  EngineLoad: '%'
};

function unitOf(name: string): string {
  return FALLBACK_UNITS[name] ?? store.signalUnits.get(name) ?? '';
}

// 定时刷新，用于判断信号是否停更
const nowTick = ref(Date.now());
let tickTimer: number | undefined;
onMounted(() => {
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  if (tickTimer !== undefined) clearInterval(tickTimer);
});

function lastPoint(name: string): { time: number; value: number } | null {
  const sig = store.signals.get(name);
  if (!sig || sig.data.length === 0) return null;
  return sig.data[sig.data.length - 1];
}

function isStale(name: string): boolean {
  const p = lastPoint(name);
  if (!p) return false;
  return nowTick.value - p.time > STALE_MS;
}

// 当前读数：与列表页解码读数同源（同一次 decode 的结果），格式也保持一致
function readingText(name: string): string {
  const p = lastPoint(name);
  if (!p) return '—';
  const unit = unitOf(name);
  return p.value.toFixed(1) + (unit ? ' ' + unit : '');
}

const hasAnyData = computed(() =>
  store.selectedSignals.some(name => {
    const sig = store.signals.get(name);
    return sig !== undefined && sig.data.length > 0;
  })
);

// 构造曲线数据：相邻两点间隔超过 GAP_MS 时插入空点，让曲线断开而不是拉直线
function buildSeriesData(data: { time: number; value: number }[]): (number | null)[][] {
  const out: (number | null)[][] = [];
  let prevTime: number | null = null;
  for (const p of data) {
    if (prevTime !== null && p.time - prevTime > GAP_MS) {
      out.push([(prevTime + p.time) / 2, null]);
    }
    out.push([p.time, p.value]);
    prevTime = p.time;
  }
  return out;
}

const chartOption = computed(() => {
  const series = store.selectedSignals.map(name => {
    const color = colorOf(name);
    const sig = store.signals.get(name);
    return {
      name,
      type: 'line' as const,
      smooth: true,
      symbol: 'none',
      connectNulls: false,
      animation: false,
      clip: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      emphasis: { focus: 'series' as const },
      endLabel: {
        show: true,
        formatter: name,
        color,
        fontSize: 10,
        distance: 6
      },
      data: buildSeriesData(sig ? sig.data : [])
    };
  });

  return {
    backgroundColor: '#111827',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2937',
      borderColor: '#374151',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const valid = params.filter((p: any) => p.value && p.value[1] != null);
        if (valid.length === 0) return '';
        const time = new Date(valid[0].value[0]).toLocaleTimeString('zh-CN', { hour12: false });
        let html = `<div style="font-size:11px;color:#9ca3af">${time}</div>`;
        for (const p of valid) {
          html += `<div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
            <span>${p.seriesName}: <b>${Number(p.value[1]).toFixed(1)}</b></span>
          </div>`;
        }
        return html;
      }
    },
    legend: {
      type: 'scroll',
      top: 4,
      left: 8,
      right: 8,
      height: 24,
      textStyle: { color: '#9ca3af', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 2,
      pageIconColor: '#9ca3af',
      pageIconInactiveColor: '#4b5563',
      pageTextStyle: { color: '#9ca3af' }
    },
    grid: {
      left: 56,
      right: 110,
      top: 40,
      bottom: 30
    },
    xAxis: {
      type: 'time',
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        hideOverlap: true,
        formatter: (val: number) => {
          const d = new Date(val);
          return d.toLocaleTimeString('zh-CN', { hour12: false });
        }
      },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } }
    },
    series
  };
});
</script>

<template>
  <div class="relative flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
    <div class="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between shrink-0">
      <h3 class="text-sm font-semibold text-gray-300">信号趋势图</h3>
      <span class="text-xs text-gray-500">
        已选 {{ store.selectedSignals.length }} / {{ store.availableSignals.length }} 个信号
      </span>
    </div>

    <!-- 信号挑选器 -->
    <div class="px-3 py-2 bg-gray-800/60 border-b border-gray-700 shrink-0">
      <div class="flex flex-wrap items-center gap-1.5 max-h-20 overflow-y-auto">
        <button
          v-for="name in store.availableSignals"
          :key="name"
          @click="store.toggleSignal(name)"
          class="flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors"
          :class="store.selectedSignals.includes(name)
            ? 'border-cyan-500 bg-cyan-900/30 text-gray-100'
            : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-500'"
        >
          <span
            class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            :style="{ background: colorOf(name), opacity: store.selectedSignals.includes(name) ? 1 : 0.35 }"
          ></span>
          <span>{{ name }}</span>
          <svg
            v-if="store.selectedSignals.includes(name)"
            class="w-3 h-3 text-cyan-400 shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <span v-if="store.availableSignals.length === 0" class="text-xs text-gray-500">
          暂无信号 — 点击"开始捕获"后此处会列出可挑选的信号
        </span>
      </div>
      <div v-if="store.availableSignals.length > 0" class="flex items-center gap-3 mt-1.5">
        <button
          @click="store.selectAllSignals()"
          class="text-xs text-gray-500 hover:text-cyan-400 transition-colors"
        >全选</button>
        <button
          @click="store.clearSelectedSignals()"
          class="text-xs text-gray-500 hover:text-cyan-400 transition-colors"
        >清空</button>
      </div>
    </div>

    <!-- 选中信号的当前读数 -->
    <div
      v-if="store.selectedSignals.length > 0"
      class="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-700 shrink-0"
    >
      <div
        v-for="name in store.selectedSignals"
        :key="name"
        class="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 border border-gray-700"
      >
        <span
          class="inline-block w-2 h-2 rounded-full shrink-0"
          :style="{ background: colorOf(name) }"
        ></span>
        <span class="text-xs text-gray-400">{{ name }}</span>
        <span
          class="text-xs font-mono font-bold"
          :class="isStale(name) ? 'text-gray-500' : 'text-gray-100'"
        >{{ readingText(name) }}</span>
        <span v-if="isStale(name)" class="text-[10px] text-gray-600">停更</span>
      </div>
    </div>

    <!-- 图表区 -->
    <div v-if="store.selectedSignals.length > 0" class="flex-1 p-2 relative min-h-0">
      <VChart
        ref="chartRef"
        :option="chartOption"
        autoresize
        class="w-full h-full"
        style="min-height: 200px;"
      />
      <div
        v-if="!hasAnyData"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <p class="text-gray-600 text-sm">等待信号数据...</p>
      </div>
    </div>

    <!-- 未挑选信号时的引导语 -->
    <div v-else class="flex-1 flex items-center justify-center px-8">
      <p class="text-gray-500 text-sm text-center leading-relaxed">
        还没有挑选信号 — 在上方列表中点击信号名称即可挑选，被选中的信号会各自绘制一条曲线并显示当前读数。
      </p>
    </div>
  </div>
</template>
