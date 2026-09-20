// ─────────────────────────────────────────────────────────────────────────────
// 验收台状态：
//   - 配置（version / faults）进入撤销/重做栈；任何配置变更自动重挂载并重置进度
//   - 六步结果与套件结果是配置的派生产物，不进历史，但会持久化用于刷新恢复
//   - 恢复自 localStorage 的结果标记 stale（DOM 会话已是新的，证据属于刷新前快照）
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CheckId,
  FaultSet,
  LogEntry,
  StepResult,
  SuiteResult,
} from '../contract/types'
import { STEP_ORDER } from './stepOrder'

export interface BenchConfig {
  version: string
  faults: FaultSet
}

export interface BenchState {
  config: BenchConfig
  currentStep: CheckId
  results: Partial<Record<CheckId, StepResult>>
  suites: SuiteResult[] | null
  logs: LogEntry[]
  running: boolean
  restoredAt: number | null
  past: BenchConfig[]
  future: BenchConfig[]
}

export const DEFAULT_CONFIG: BenchConfig = { version: 'v2', faults: [] }

export type BenchAction =
  | { type: 'config'; patch: Partial<BenchConfig> }
  | { type: 'setStep'; step: CheckId; running?: boolean }
  | { type: 'runDone'; results: Partial<Record<CheckId, StepResult>>; logs: LogEntry[] }
  | { type: 'suites'; suites: SuiteResult[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'restore'; state: PersistedShape }
  | { type: 'setRunning'; running: boolean }

interface PersistedShape {
  config: BenchConfig
  currentStep: CheckId
  results: Partial<Record<CheckId, StepResult>>
  suites: SuiteResult[] | null
  logs: LogEntry[]
  savedAt: number
}

function freshRunState(config: BenchConfig) {
  return {
    config,
    currentStep: 'mount' as CheckId,
    results: {} as Partial<Record<CheckId, StepResult>>,
    suites: null,
    logs: [] as LogEntry[],
  }
}

export function benchReducer(state: BenchState, action: BenchAction): BenchState {
  switch (action.type) {
    case 'config': {
      const next: BenchConfig = {
        version: action.patch.version ?? state.config.version,
        faults: action.patch.faults ?? state.config.faults,
      }
      if (next.version === state.config.version && sameFaults(next.faults, state.config.faults)) {
        return state
      }
      return {
        ...state,
        ...freshRunState(next),
        running: false,
        restoredAt: null,
        past: [...state.past, state.config],
        future: [],
      }
    }
    case 'setStep':
      if (action.step === state.currentStep && !action.running) return state
      return { ...state, currentStep: action.step, running: action.running ?? state.running }
    case 'runDone':
      return {
        ...state,
        results: action.results,
        logs: action.logs,
        // running 由自动流程自己收尾；单步不使用 running
        // 真实执行覆盖刷新前快照
        restoredAt: null,
      }
    case 'suites':
      return { ...state, suites: action.suites }
    case 'undo': {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return {
        ...state,
        ...freshRunState(previous),
        running: false,
        past: state.past.slice(0, -1),
        future: [state.config, ...state.future],
      }
    }
    case 'redo': {
      if (!state.future.length) return state
      const next = state.future[0]
      return {
        ...state,
        ...freshRunState(next),
        running: false,
        past: [...state.past, state.config],
        future: state.future.slice(1),
      }
    }
    case 'reset':
      return {
        ...state,
        ...freshRunState(DEFAULT_CONFIG),
        running: false,
        restoredAt: null,
        past: [...state.past, state.config],
        future: [],
      }
    case 'restore': {
      const { config, currentStep, results, suites, logs, savedAt } = action.state
      const staleResults = Object.fromEntries(
        Object.entries(results).map(([k, v]) => [k, { ...(v as StepResult), stale: true as const }]),
      )
      const staleSuites = suites?.map((s) => ({ ...s, stale: true as const })) ?? null
      return {
        ...state,
        config,
        currentStep,
        results: staleResults,
        suites: staleSuites,
        logs,
        restoredAt: savedAt,
        running: false,
        past: [],
        future: [],
      }
    }
    case 'setRunning':
      return { ...state, running: action.running }
    default:
      return state
  }
}

function sameFaults(a: FaultSet, b: FaultSet): boolean {
  if (a.length !== b.length) return false
  const sb = new Set(b)
  return a.every((f) => sb.has(f))
}

// ── 持久化 ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'slotcontract:snapshot:v1'

export function persistState(state: BenchState) {
  try {
    const shape: PersistedShape = {
      config: state.config,
      currentStep: state.currentStep,
      results: state.results,
      suites: state.suites,
      logs: state.logs.slice(-200),
      savedAt: Date.now(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch {
    // 存储不可用时静默降级（隐私模式等）
  }
}

export function loadPersisted(): PersistedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedShape
    if (!parsed.config || !STEP_IDS.has(parsed.currentStep)) return null
    return parsed
  } catch {
    return null
  }
}

const STEP_IDS = new Set<CheckId>(STEP_ORDER)

export function freshState(): BenchState {
  return {
    ...freshRunState(DEFAULT_CONFIG),
    running: false,
    restoredAt: null,
    past: [],
    future: [],
  }
}
