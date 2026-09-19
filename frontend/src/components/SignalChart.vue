<script setup lang="ts">
import { computed, ref } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent
} from 'echarts/components';
import { useCanBusStore } from '../store/canbus';
import type { SignalPoint, SignalSeries } from '../types';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);

const store = useCanBusStore();

// 为信号名分配稳定颜色：同一信号无论何时进入挑选都保持同色
const PALETTE = [
  '#22d3ee', '#4ade80', '#f87171', '#facc15', '#c084fc',
  '#fb923c', '#60a5fa', '#f472b6', '#a3e635', '#2dd4bf',
  '#e879f9', '#fbbf24'
];

const colorCache = new Map<string, string>();
function colorFor(name: string): string {
  let color = colorCache.get(name);
  if (!color) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    color = PALETTE[Math.abs(hash) % PALETTE.length];
    colorCache.set(name, color);
  }
  return color;
}

// 所有已观测到的信号，按出现顺序排列
const allSignals = computed<SignalSeries[]>(() =>
  Array.from(store.signals.values())
);

// 按用户挑选顺序返回被选中的信号（已不存在的信号保留条目，等再次出现时恢复）
const selectedSeries = computed<SignalSeries[]>(() =>
  store.selectedSignals
    .map(name => store.signals.get(name))
    .filter((s): s is SignalSeries => !!s)
);

const latestValues = computed<Record<string, SignalPoint | undefined>>(() => {
  const result: Record<string, SignalPoint | undefined> = {};
  for (const sig of selectedSeries.value) {
    result[sig.name] = sig.data.length > 0 ? sig.data[sig.data.length - 1] : undefined;
  }
  return result;
});

function formatValue(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? '--' : v.toFixed(1);
}

function formatUnit(unit: string): string {
  return unit === 'degC' ? '°C' : unit;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 构造曲线数据：相邻两点时间间隔显著大于该信号常规周期时插入空点，
 * 使曲线在没有新数据的时间段断开，而不是拿旧值斜连到下一个点。
 */
function buildSeriesData(sig: SignalSeries): ([number, number] | [number, '-'])[] {
  const points = sig.data;
  if (points.length < 2) {
    return points.map(p => [p.time, p.value]);
  }

  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    gaps.push(points[i].time - points[i - 1].time);
  }
  gaps.sort((a, b) => a - b);
  const typical = gaps[Math.floor(gaps.length / 2)] || 200;
  // 超过常规周期 4 倍即视为中断，并夹在 1s~5s，避免抖动误判
  const threshold = Math.min(5000, Math.max(1000, typical * 4));

  const out: ([number, number] | [number, '-'])[] = [[points[0].time, points[0].value]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].time - points[i - 1].time > threshold) {
      out.push([points[i - 1].time, '-']);
    }
    out.push([points[i].time, points[i].value]);
  }
  return out;
}

const chartOption = computed(() => {
  const series = selectedSeries.value.map(sig => ({
    name: sig.name,
    type: 'line' as const,
    smooth: false,
    symbol: 'none',
    connectNulls: false,
    lineStyle: { width: 2, color: colorFor(sig.name) },
    itemStyle: { color: colorFor(sig.name) },
    data: buildSeriesData(sig)
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
    color: PALETTE,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2937',
      borderColor: '#374151',
      textStyle: { color: '#e5e7eb', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const time = formatTime(params[0].value[0]);
        let html = `<div style="font-size:11px;color:#9ca3af">${time}</div>`;
        for (const p of params) {
          const sig = store.signals.get(p.seriesName);
          const unit = sig ? formatUnit(sig.unit) : '';
          const val = p.value[1] === '-' ? '无数据' : `${Number(p.value[1]).toFixed(1)} ${unit}`;
          html += `<div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
            <span>${p.seriesName}: <b>${val}</b></span>
          </div>`;
        }
        return html;
      }
    },
    grid: {
      left: 56,
      right: 16,
      top: 12,
      bottom: 28
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        formatter: (val: number) => formatTime(val)
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

// ---- 信号挑选下拉 ----
const pickerOpen = ref(false);
const pickerRef = ref<HTMLElement | null>(null);

function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
}

function onPickerBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (pickerRef.value && next && pickerRef.value.contains(next)) return;
  pickerOpen.value = false;
}

function selectAll() {
  store.selectedSignals = allSignals.value.map(s => s.name);
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
    <!-- 标题栏 -->
    <div class="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-300">信号趋势图</h3>
      <div
        ref="pickerRef"
        class="relative"
        @focusout="onPickerBlur"
      >
        <button
          @click="togglePicker"
          class="px-2 py-1 text-xs rounded border border-gray-600 text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors flex items-center gap-1"
        >
          <span>添加信号</span>
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path v-if="!pickerOpen" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
          </svg>
        </button>

        <div
          v-if="pickerOpen"
          class="absolute right-0 top-full mt-1 z-30 w-56 max-h-64 overflow-auto rounded-lg border border-gray-600 bg-gray-800 shadow-xl"
        >
          <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700 sticky top-0 bg-gray-800">
            <button @click="selectAll" class="text-xs text-cyan-400 hover:text-cyan-300">全选</button>
            <button @click="store.clearSignalSelection()" class="text-xs text-gray-400 hover:text-gray-200">清空</button>
          </div>
          <ul v-if="allSignals.length > 0">
            <li v-for="sig in allSignals" :key="sig.name">
              <label
                class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-700/60 text-xs"
              >
                <input
                  type="checkbox"
                  class="accent-cyan-500"
                  :checked="store.isSignalSelected(sig.name)"
                  @change="store.toggleSignal(sig.name)"
                />
                <span
                  class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  :style="{ backgroundColor: colorFor(sig.name) }"
                ></span>
                <span class="text-gray-200 truncate">{{ sig.name }}</span>
                <span class="ml-auto text-gray-500 shrink-0">{{ sig.data.length }}</span>
              </label>
            </li>
          </ul>
          <p v-else class="px-3 py-3 text-xs text-gray-500 text-center">暂无信号，开始捕获后再选择</p>
        </div>
      </div>
    </div>

    <!-- 已挑选信号：每条线对应一个带当前读数的标签 -->
    <div
      v-if="store.selectedSignals.length > 0"
      class="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-700 bg-gray-900"
    >
      <span
        v-for="name in store.selectedSignals"
        :key="name"
        class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-xs border"
        :style="{
          borderColor: colorFor(name) + '66',
          backgroundColor: colorFor(name) + '1a'
        }"
      >
        <span
          class="w-2 h-2 rounded-full"
          :style="{ backgroundColor: colorFor(name) }"
        ></span>
        <span class="text-gray-300">{{ name }}</span>
        <span class="font-mono font-semibold" :style="{ color: colorFor(name) }">
          {{ formatValue(latestValues[name]?.value) }}
          <span class="text-gray-500 font-normal">{{ formatUnit(store.signals.get(name)?.unit ?? '') }}</span>
        </span>
        <button
          @click="store.toggleSignal(name)"
          class="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-200 hover:bg-gray-700"
          :title="`移除 ${name}`"
        >×</button>
      </span>
    </div>

    <!-- 图表区 -->
    <div class="relative flex-1 p-2 min-h-0">
      <VChart
        v-if="selectedSeries.length > 0"
        :option="chartOption"
        autoresize
        class="w-full h-full"
      />

      <!-- 引导/空态 -->
      <div v-if="allSignals.length === 0" class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <p class="text-gray-600 text-sm">等待信号数据...</p>
      </div>
      <div
        v-else-if="selectedSeries.length === 0"
        class="absolute inset-0 flex items-center justify-center px-6"
      >
        <p class="text-gray-400 text-sm text-center">
          点击右上角<span class="text-cyan-400">「添加信号」</span>勾选要查看的信号，每条信号将单独绘制曲线并显示当前读数
        </p>
      </div>
    </div>
  </div>
</template>
