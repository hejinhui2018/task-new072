// ─────────────────────────────────────────────────────────────────────────────
// 编排：reducer 状态 ↔ 真实 DOM 会话
// currentStep / config 任一变化 → 销毁旧会话，在舞台上重放到目标步骤（重放保证幂等）
// 刷新恢复后处于 snapshot 模式：先展示带 stale 标记的旧报告，首次运行即回到 live
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CheckId, LogEntry, StepResult } from '../contract/types'
import {
  benchReducer,
  freshState,
  loadPersisted,
  persistState,
} from './benchReducer'
import { STEP_ORDER } from './stepOrder'
import { runUntil, type CheckSession } from '../engine/runChecks'
import { runSuites as runSuitesEngine } from '../engine/suites'
import type { BenchContext } from '../engine/mountBench'

function init() {
  const base = freshState()
  const persisted = loadPersisted()
  if (persisted) {
    return benchReducer(base, { type: 'restore', state: persisted })
  }
  return base
}

export function useBench() {
  const [state, dispatch] = useReducer(benchReducer, undefined, init)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<CheckSession | null>(null)
  const autoRef = useRef<{ cancelled: boolean } | null>(null)
  const [, setTick] = useState(0)
  const [suitesRunning, setSuitesRunning] = useState(false)

  const faultKey = state.config.faults.slice().sort().join(',')
  const snapshotMode = state.restoredAt !== null

  // 配置 / 步骤变化 → 重放挂载（snapshot 模式下保持舞台为恢复提示，不建会话）
  useEffect(() => {
    if (snapshotMode) {
      sessionRef.current?.teardown()
      sessionRef.current = null
      return
    }
    const stage = stageRef.current
    if (!stage) return
    sessionRef.current?.teardown()
    const session = runUntil(state.currentStep, {
      version: state.config.version,
      faults: state.config.faults,
      stage,
    })
    sessionRef.current = session
    dispatch({ type: 'runDone', results: session.results, logs: session.ctx.logs })
    return () => {
      session.teardown()
      if (sessionRef.current === session) sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config.version, faultKey, state.currentStep, snapshotMode])

  // live 轮询：内部日志 / host 事件 / 探针在用户直接点舞台元素时也能刷新
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500)
    return () => window.clearInterval(id)
  }, [])

  // 持久化
  useEffect(() => {
    persistState(state)
  }, [state])

  const stepNow = useCallback((step: CheckId) => {
    if (autoRef.current) autoRef.current.cancelled = true
    dispatch({ type: 'setStep', step })
  }, [])

  const autoRun = useCallback(() => {
    const token = { cancelled: false }
    autoRef.current = token
    dispatch({ type: 'setRunning', running: true })
    // 无论当前在哪一步，从第一步顺序跑到最后
    dispatch({ type: 'setStep', step: 'mount' })
    let i = 0
    const advance = () => {
      if (token.cancelled) {
        dispatch({ type: 'setRunning', running: false })
        return
      }
      if (i >= STEP_ORDER.length) {
        autoRef.current = null
        dispatch({ type: 'setRunning', running: false })
        return
      }
      dispatch({ type: 'setStep', step: STEP_ORDER[i] })
      i++
      window.setTimeout(advance, 750)
    }
    window.setTimeout(advance, 350)
  }, [])

  const stopAuto = useCallback(() => {
    if (autoRef.current) autoRef.current.cancelled = true
    autoRef.current = null
    dispatch({ type: 'setRunning', running: false })
  }, [])

  const runSuitesNow = useCallback(async () => {
    setSuitesRunning(true)
    try {
      const suites = await runSuitesEngine(state.config.version, state.config.faults)
      dispatch({ type: 'suites', suites })
    } finally {
      setSuitesRunning(false)
    }
  }, [state.config.version, faultKey])

  const liveCtx: BenchContext | null = sessionRef.current?.ctx ?? null

  return {
    state,
    dispatch,
    stageRef,
    liveCtx,
    snapshotMode,
    suitesRunning,
    stepNow,
    autoRun,
    stopAuto,
    runSuitesNow,
  }
}

export type BenchApi = ReturnType<typeof useBench>

// 给日志面板一个稳定的渲染辅助
export function useLogsDigest(logs: LogEntry[], results: Partial<Record<CheckId, StepResult>>) {
  return useMemo(() => {
    const stepRuns = Object.values(results)
      .filter((r): r is StepResult => !!r)
      .map((r) => ({ t: r.ranAt, title: r.title }))
    return { count: logs.length, stepRuns }
  }, [logs, results])
}
