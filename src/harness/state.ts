import type { FaultSet, StepResult, VersionId } from '../contract/types';
import type { RunConfig } from '../engine/runner';

export interface Present extends RunConfig {
  results: (StepResult | null)[];
}

export interface HarnessState {
  past: Present[];
  present: Present;
  future: Present[];
  /** 本次启动是否由持久化恢复 */
  hydrated: boolean;
}

export type HarnessAction =
  | { type: 'setVersion'; version: VersionId }
  | { type: 'toggleCompat' }
  | { type: 'toggleFault'; fault: keyof FaultSet }
  | { type: 'recordStep'; result: StepResult }
  | { type: 'resetResults' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'hydrate'; present: Present };

export const STEP_COUNT = 7;

export function initialPresent(): Present {
  return { version: 'v2', compat: false, faults: {}, results: Array(STEP_COUNT).fill(null) };
}

export function initialState(): HarnessState {
  return { past: [], present: initialPresent(), future: [], hydrated: false };
}

/** 配置类变更会使已执行步骤的结论失效，因此连带清空结果 */
function withConfigChange(state: HarnessState, next: Omit<Present, 'results'>): HarnessState {
  return {
    past: [...state.past, state.present],
    present: { ...next, results: Array(STEP_COUNT).fill(null) },
    future: [],
    hydrated: state.hydrated,
  };
}

function commit(state: HarnessState, present: Present): HarnessState {
  return {
    past: [...state.past, state.present],
    present,
    future: [],
    hydrated: state.hydrated,
  };
}

export function reducer(state: HarnessState, action: HarnessAction): HarnessState {
  switch (action.type) {
    case 'setVersion':
      return withConfigChange(state, {
        version: action.version,
        compat: state.present.compat,
        faults: state.present.faults,
      });
    case 'toggleCompat':
      return withConfigChange(state, {
        version: state.present.version,
        compat: !state.present.compat,
        faults: state.present.faults,
      });
    case 'toggleFault': {
      const faults = { ...state.present.faults };
      if (faults[action.fault]) delete faults[action.fault];
      else faults[action.fault] = true;
      return withConfigChange(state, {
        version: state.present.version,
        compat: state.present.compat,
        faults,
      });
    }
    case 'recordStep': {
      const results = state.present.results.slice();
      results[action.result.index] = action.result;
      return commit(state, { ...state.present, results });
    }
    case 'resetResults':
      return commit(state, {
        ...state.present,
        results: Array(STEP_COUNT).fill(null),
      });
    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        hydrated: state.hydrated,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        hydrated: state.hydrated,
      };
    }
    case 'hydrate':
      // 刷新恢复：配置与“已执行到第几步”回来，结论由挂载后真实重放重新产生
      return { past: [], present: action.present, future: [], hydrated: true };
    default:
      return state;
  }
}

const STORAGE_KEY = 'slot-contract-harness:v1';

interface PersistShape {
  version: VersionId;
  compat: boolean;
  faults: FaultSet;
  /** 仅持久化已执行步骤的下标，用于刷新后重放；结论不跨 DOM 实例携带 */
  executed: number[];
}

export function persistPresent(present: Present): void {
  try {
    const shape: PersistShape = {
      version: present.version,
      compat: present.compat,
      faults: present.faults,
      executed: present.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // 隐私模式等场景下落空为无持久化，不影响验收
  }
}

export function loadPersisted(): { present: Present; executed: number[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const shape = JSON.parse(raw) as PersistShape;
    if (shape.version !== 'v1' && shape.version !== 'v2') return null;
    const results = Array(STEP_COUNT).fill(null);
    const executed = Array.isArray(shape.executed)
      ? shape.executed.filter((i) => Number.isInteger(i) && i >= 0 && i < STEP_COUNT)
      : [];
    return {
      present: { version: shape.version, compat: !!shape.compat, faults: shape.faults ?? {}, results },
      executed,
    };
  } catch {
    return null;
  }
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
