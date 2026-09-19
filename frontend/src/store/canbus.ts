import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { CanFrame, DbcMessage, BusStats, SignalSeries } from '../types';
import { parseDbc, decodeCanFrame, DEFAULT_DBC_CONTENT } from '../utils/dbc-parser';

let frameIdCounter = 0;

const SELECTION_STORAGE_KEY = 'canbus.chart.selectedSignals';

function loadSelectedSignals(): string[] {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export const useCanBusStore = defineStore('canbus', () => {
  const frames = ref<CanFrame[]>([]);
  const signals = ref<Map<string, SignalSeries>>(new Map());
  const dbcMessages = ref<Map<number, DbcMessage>>(new Map());
  const filterId = ref('');
  const filterText = ref('');
  const isCapturing = ref(false);
  const pollInterval = ref<number | null>(null);

  // 用户在趋势图中挑选的信号；默认不选任何信号，选择跨界面切换与窗口重开保留
  const selectedSignals = ref<string[]>(loadSelectedSignals());

  watch(
    selectedSignals,
    names => {
      try {
        localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(names));
      } catch {
        // 存储不可用时静默降级（仅保留在内存中）
      }
    },
    { deep: true }
  );

  function isSignalSelected(name: string): boolean {
    return selectedSignals.value.includes(name);
  }

  function toggleSignal(name: string) {
    if (isSignalSelected(name)) {
      selectedSignals.value = selectedSignals.value.filter(n => n !== name);
    } else {
      selectedSignals.value = [...selectedSignals.value, name];
    }
  }

  function selectOnlySignal(name: string) {
    selectedSignals.value = [name];
  }

  function clearSignalSelection() {
    selectedSignals.value = [];
  }

  const busStats = ref<BusStats>({
    totalFrames: 0,
    rxCount: 0,
    txCount: 0,
    errorCount: 0,
    busLoad: 0,
    lastUpdate: Date.now()
  });

  const filteredFrames = computed(() => {
    let result = frames.value;

    if (filterId.value.trim()) {
      const idFilter = filterId.value.trim().toLowerCase().replace(/^0x/, '');
      result = result.filter(f =>
        f.arbitrationId.toString(16).toLowerCase().includes(idFilter)
      );
    }

    if (filterText.value.trim()) {
      const textFilter = filterText.value.trim().toLowerCase();
      result = result.filter(f => {
        if (f.arbitrationId.toString(16).toLowerCase().includes(textFilter)) return true;
        if (f.data.toLowerCase().includes(textFilter)) return true;
        for (const key of Object.keys(f.decoded)) {
          if (key.toLowerCase().includes(textFilter)) return true;
        }
        return false;
      });
    }

    return result;
  });

  const busLoadPercent = computed(() => {
    return busStats.value.busLoad.toFixed(1);
  });

  function addFrame(frame: CanFrame) {
    frames.value.push(frame);
    if (frames.value.length > 500) {
      frames.value = frames.value.slice(-500);
    }

    busStats.value.totalFrames++;
    if (frame.direction === 'RX') busStats.value.rxCount++;
    else busStats.value.txCount++;
    busStats.value.lastUpdate = Date.now();

    // Update signal history —— 与列表页使用同一份解码结果，保证读数一致
    const msgDef = dbcMessages.value.get(frame.arbitrationId);
    if (msgDef) {
      const decoded = decodeCanFrame(frame, msgDef);
      frame.decoded = decoded;
      for (const sigDef of msgDef.signals) {
        const value = decoded[sigDef.name];
        if (typeof value !== 'number') continue;
        if (!signals.value.has(sigDef.name)) {
          signals.value.set(sigDef.name, { name: sigDef.name, unit: sigDef.unit, data: [] });
        }
        const sig = signals.value.get(sigDef.name)!;
        sig.data.push({ time: frame.timestamp, value });
        if (sig.data.length > 200) {
          sig.data = sig.data.slice(-200);
        }
      }
    }

    // Simulate bus load (random 15-45%)
    busStats.value.busLoad = 15 + Math.random() * 30;
  }

  function clearFrames() {
    frames.value = [];
    signals.value = new Map();
    busStats.value = {
      totalFrames: 0,
      rxCount: 0,
      txCount: 0,
      errorCount: 0,
      busLoad: 0,
      lastUpdate: Date.now()
    };
    frameIdCounter = 0;
  }

  function loadMockDbc() {
    parseAndLoadDbc(DEFAULT_DBC_CONTENT);
  }

  function parseAndLoadDbc(text: string) {
    dbcMessages.value = parseDbc(text);
  }

  // 模拟信号源当前值（随机游走），以及 2025 车辆消息的随机停顿，用于验证曲线断线
  const mockValues: Record<string, number> = {
    EngineRPM: 2000,
    ThrottlePosition: 30,
    EngineLoad: 35,
    VehicleSpeed: 40,
    CoolantTemp: 85
  };
  let vehiclePausedUntil = 0;

  function randomWalk(key: string, min: number, max: number, step: number, decimals = 0): number {
    let next = mockValues[key] + (Math.random() - 0.5) * 2 * step;
    next = Math.max(min, Math.min(max, next));
    next = Number(next.toFixed(decimals));
    mockValues[key] = next;
    return next;
  }

  function setBits(dataBytes: number[], startBit: number, bitLength: number, raw: number) {
    for (let i = 0; i < bitLength; i++) {
      const bitIndex = startBit + i;
      const byte = Math.floor(bitIndex / 8);
      const bit = bitIndex % 8;
      if ((raw >> i) & 1) dataBytes[byte] |= 1 << bit;
      else dataBytes[byte] &= ~(1 << bit);
    }
  }

  function generateMockFrame(): CanFrame {
    const now = Date.now();
    const hasEngine = dbcMessages.value.has(2024);
    const hasVehicle = dbcMessages.value.has(2025);

    // 每 ~4 秒有 10% 概率让车辆消息停顿 3~6 秒，期间该消息无新点
    if (hasVehicle && now >= vehiclePausedUntil && Math.random() < 0.005) {
      vehiclePausedUntil = now + 3000 + Math.random() * 3000;
    }

    const useEngine = hasEngine && (now < vehiclePausedUntil || !hasVehicle || Math.random() < 0.65);
    const arbId = useEngine ? 2024 : 2025;
    const dataBytes = [0, 0, 0, 0, 0, 0, 0, 0];

    if (useEngine) {
      const rpm = randomWalk('EngineRPM', 800, 6000, 120);
      const throttle = randomWalk('ThrottlePosition', 0, 100, 3);
      const load = randomWalk('EngineLoad', 0, 100, 3);
      setBits(dataBytes, 0, 16, Math.round(rpm / 0.25));
      setBits(dataBytes, 16, 8, Math.round(throttle / 0.392));
      setBits(dataBytes, 24, 8, Math.round(load / 0.392));
    } else {
      const speed = randomWalk('VehicleSpeed', 0, 180, 4);
      const temp = randomWalk('CoolantTemp', 60, 110, 0.5, 1);
      setBits(dataBytes, 0, 8, Math.round(speed));
      setBits(dataBytes, 8, 8, Math.round(temp + 40));
    }

    const dataHex = dataBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    // decoded 由 addFrame 统一按 DBC 解码，此处不再硬编码，保证与列表页读数同源
    const frame: CanFrame = {
      id: `frame-${++frameIdCounter}`,
      timestamp: now,
      arbitrationId: arbId,
      dlc: 8,
      data: dataHex,
      decoded: {},
      direction: Math.random() > 0.3 ? 'RX' : 'TX'
    };

    return frame;
  }

  function startCapture() {
    if (isCapturing.value) return;
    isCapturing.value = true;

    // Load mock DBC if not loaded
    if (dbcMessages.value.size === 0) {
      loadMockDbc();
    }

    pollInterval.value = window.setInterval(() => {
      const frame = generateMockFrame();
      addFrame(frame);
    }, 200);
  }

  function stopCapture() {
    isCapturing.value = false;
    if (pollInterval.value !== null) {
      clearInterval(pollInterval.value);
      pollInterval.value = null;
    }
  }

  function decodeFrame(frame: CanFrame): Record<string, number> {
    const msgDef = dbcMessages.value.get(frame.arbitrationId);
    if (!msgDef) return {};
    return decodeCanFrame(frame, msgDef);
  }

  function exportFrames(): string {
    const header = 'Timestamp,Direction,CAN_ID,DLC,Data,Decoded\n';
    const rows = frames.value.map(f => {
      const decodedStr = Object.entries(f.decoded)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      return `${f.timestamp},${f.direction},0x${f.arbitrationId.toString(16).toUpperCase()},${f.dlc},"${f.data}","${decodedStr}"`;
    }).join('\n');
    return header + rows;
  }

  return {
    frames,
    signals,
    dbcMessages,
    filterId,
    filterText,
    busStats,
    isCapturing,
    selectedSignals,
    filteredFrames,
    busLoadPercent,
    addFrame,
    clearFrames,
    loadMockDbc,
    parseAndLoadDbc,
    startCapture,
    stopCapture,
    decodeFrame,
    exportFrames,
    isSignalSelected,
    toggleSignal,
    selectOnlySignal,
    clearSignalSelection
  };
});
