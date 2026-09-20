import { useBench } from './state/useBench'
import { Toolbar } from './components/Toolbar'
import { HostPanel } from './components/HostPanel'
import { ElementPanel } from './components/ElementPanel'
import { ReportPanel } from './components/ReportPanel'
import { SuitesPanel } from './components/SuitesPanel'
import { LogConsole } from './components/LogConsole'
import { STEP_ORDER } from './state/stepOrder'
import type { FaultKey } from './contract/types'

export default function App() {
  const bench = useBench()
  const { state, dispatch } = bench
  const currentIndex = STEP_ORDER.indexOf(state.currentStep)

  const toggleFault = (f: FaultKey) => {
    const has = state.config.faults.includes(f)
    const faults = has ? state.config.faults.filter((x) => x !== f) : [...state.config.faults, f]
    dispatch({ type: 'config', patch: { faults } })
  }

  const stepOnce = () => {
    const next = STEP_ORDER[currentIndex + 1]
    if (next) bench.stepNow(next)
  }

  const logs = bench.liveCtx?.logs ?? state.logs

  return (
    <div className="app">
      <div className="app-header">
        <h1>SlotContract 集成契约验收台</h1>
        <span className="sub">
          旧组件 → Web Components 升级验收 · 真实 Shadow DOM · 宿主按 v1 契约固定不动
        </span>
      </div>

      <Toolbar
        config={state.config}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        running={state.running}
        currentIndex={currentIndex}
        onVersion={(v) => dispatch({ type: 'config', patch: { version: v } })}
        onToggleFault={toggleFault}
        onStep={stepOnce}
        onAuto={bench.autoRun}
        onStop={bench.stopAuto}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onReset={() => dispatch({ type: 'reset' })}
        onSuites={bench.runSuitesNow}
        suitesRunning={bench.suitesRunning}
      />

      {bench.snapshotMode && (
        <div className="stale-banner">
          ⟳ 已从上次会话恢复（快照时间 {state.restoredAt ? new Date(state.restoredAt).toLocaleString() : ''}）：
          报告与日志是刷新前的结果（标记“快照”），页面上没有挂载真实 DOM。执行任意步骤或切换版本，即在当前配置下重新挂载验收。
        </div>
      )}

      <div className="legend">
        <span><span className="dot pass" /> 直接满足：原生行为即符合 v1 契约</span>
        <span><span className="dot adapted" /> 兼容适配：靠显式垫片达成，报告列出适配痕迹与成本</span>
        <span><span className="dot loss" /> 静默丢失：不报错但宿主侧契约失效（本次升级的主要风险）</span>
        <span><span className="dot fail" /> 硬失败：显式报错或事件被明确截停</span>
      </div>

      <div className="grid">
        <HostPanel
          stageRef={bench.stageRef}
          liveCtx={bench.liveCtx}
          version={state.config.version}
          snapshotMode={bench.snapshotMode}
          restoredAt={state.restoredAt}
        />

        <div className="col">
          <ElementPanel liveCtx={bench.liveCtx} />
          <div className="panel scroll-body" style={{ flex: '0 0 220px' }}>
            <div className="panel-h">
              内部日志
              <span className="tagline">元素 / 适配层 / 宿主 / 引擎 四侧时序</span>
            </div>
            <div className="panel-b" style={{ paddingTop: 8 }}>
              <LogConsole logs={logs} />
            </div>
          </div>
        </div>

        <div className="col">
          <ReportPanel
            version={state.config.version}
            results={state.results}
            currentStep={state.currentStep}
            onSelect={(id) => bench.stepNow(id)}
          />
        </div>

        <div style={{ gridColumn: '1 / -1', minHeight: 0, maxHeight: 340, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <SuitesPanel suites={state.suites} />
          </div>
        </div>
      </div>
    </div>
  )
}
