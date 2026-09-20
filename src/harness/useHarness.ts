import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { defineElements, setGlobalFaults } from '../contract/elements';
import { StageRunner } from '../engine/runner';
import {
  clearPersisted,
  initialPresent,
  initialState,
  loadPersisted,
  persistPresent,
  reducer,
  STEP_COUNT,
  type Present,
} from './state';
import type { FaultId, VersionId } from '../contract/types';
import type { RunConfig } from '../engine/runner';

const AUTO_STEP_MS = 650;
const REPLAY_STEP_MS = 140;

function shallowEqualFaults(a: RunConfig['faults'], b: RunConfig['faults']): boolean {
  const ka = Object.keys(a).filter((k) => a[k as FaultId]);
  const kb = Object.keys(b).filter((k) => b[k as FaultId]);
  return ka.length === kb.length && ka.every((k) => b[k as FaultId]);
}

export interface HarnessApi {
  present: Present;
  canUndo: boolean;
  canRedo: boolean;
  hydrated: boolean;
  isAuto: boolean;
  stageRef: React.RefObject<HTMLDivElement>;
  ready: boolean;
  setVersion: (v: VersionId) => void;
  toggleCompat: () => void;
  toggleFault: (f: FaultId) => void;
  runStep: (i: number) => void;
  runAll: () => void;
  stopAuto: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export function useHarness(): HarnessApi {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [ready, setReady] = useState(false);
  const [isAuto, setIsAuto] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<StageRunner | null>(null);
  const autoCancel = useRef(true);
  const skipPersistOnce = useRef(false);
  const configRef = useRef<Present>(state.present);
  configRef.current = state.present;

  // 挂载：注册元素 -> 读取持久化 -> 真实挂载 -> 在新 DOM 上重放已执行步骤
  useEffect(() => {
    defineElements();
    const restored = loadPersisted();
    const start = restored?.present ?? initialPresent();
    setGlobalFaults(start.faults);
    if (restored) dispatch({ type: 'hydrate', present: restored.present });

    runnerRef.current = new StageRunner(stageRef.current!, {
      version: start.version,
      compat: start.compat,
      faults: start.faults,
    });
    runnerConfig.current = { version: start.version, compat: start.compat, faults: start.faults };
    setReady(true);

    let cancelled = false;
    if (restored && restored.executed.length > 0) {
      (async () => {
        for (const i of restored.executed) {
          await new Promise((r) => setTimeout(r, REPLAY_STEP_MS));
          if (cancelled) return;
          dispatch({ type: 'recordStep', result: runnerRef.current!.runStep(i, true) });
        }
      })();
    }
    return () => {
      cancelled = true;
      runnerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 配置变更：全局故障开关 + 按新配置重建舞台（结果已由 reducer 清空）。
  // 与 runner 当前配置比较：首次（挂载/重放）配置相同，跳过；之后的用户切换才重建。
  const runnerConfig = useRef<RunConfig | null>(null);
  const { version, compat, faults } = state.present;
  useEffect(() => {
    if (!ready) return;
    const next: RunConfig = { version, compat, faults };
    const cur = runnerConfig.current;
    if (
      cur &&
      cur.version === next.version &&
      cur.compat === next.compat &&
      shallowEqualFaults(cur.faults, next.faults)
    ) {
      return;
    }
    runnerConfig.current = next;
    autoCancel.current = true;
    setIsAuto(false);
    setGlobalFaults(faults);
    runnerRef.current?.setConfig(next);
  }, [version, compat, faults, ready]);

  // 持久化：只存配置与已执行下标，不跨 DOM 携带结论
  useEffect(() => {
    if (!ready) return;
    if (skipPersistOnce.current) {
      skipPersistOnce.current = false;
      return;
    }
    persistPresent(state.present);
  }, [state.present, ready]);

  const runStep = useCallback((i: number) => {
    const result = runnerRef.current!.runStep(i, false);
    dispatch({ type: 'recordStep', result });
  }, []);

  const stopAuto = useCallback(() => {
    autoCancel.current = true;
    setIsAuto(false);
  }, []);

  const runAll = useCallback(() => {
    if (!runnerRef.current) return;
    autoCancel.current = false;
    setIsAuto(true);
    (async () => {
      for (let i = 0; i < STEP_COUNT; i += 1) {
        if (autoCancel.current) return;
        dispatch({ type: 'recordStep', result: runnerRef.current!.runStep(i, false) });
        await new Promise((r) => setTimeout(r, AUTO_STEP_MS));
      }
      setIsAuto(false);
    })();
  }, []);

  const reset = useCallback(() => {
    autoCancel.current = true;
    setIsAuto(false);
    const { version: v, compat: c, faults: f } = configRef.current;
    runnerRef.current?.setConfig({ version: v, compat: c, faults: f });
    skipPersistOnce.current = true; // 紧跟的 resetResults 不得把空结果写回 localStorage
    dispatch({ type: 'resetResults' });
    clearPersisted();
  }, []);

  return useMemo(
    () => ({
      present: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      hydrated: state.hydrated,
      isAuto,
      stageRef,
      ready,
      setVersion: (v: VersionId) => dispatch({ type: 'setVersion', version: v }),
      toggleCompat: () => dispatch({ type: 'toggleCompat' }),
      toggleFault: (f: FaultId) => dispatch({ type: 'toggleFault', fault: f }),
      runStep,
      runAll,
      stopAuto,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      reset,
    }),
    [state, isAuto, ready, runStep, runAll, stopAuto, reset],
  );
}
