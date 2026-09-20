import { FAULTS, type FaultSet } from '../contract/types'
import type { BenchConfig } from '../state/benchReducer'
import { CONTRACTS } from '../contract/versions'
import { STEP_ORDER } from '../state/stepOrder'
import { STEP_META } from '../engine/runChecks'

interface Props {
  config: BenchConfig
  canUndo: boolean
  canRedo: boolean
  running: boolean
  currentIndex: number
  onVersion: (v: string) => void
  onToggleFault: (f: FaultSet[number]) => void
  onStep: () => void
  onAuto: () => void
  onStop: () => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  onSuites: () => void
  suitesRunning: boolean
}

export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      <div className="group">
        <span className="label">组件版本</span>
        <div className="ver-selector">
          {CONTRACTS.map((c) => (
            <button
              key={c.version}
              className={`btn ${p.config.version === c.version ? 'on' : ''}`}
              onClick={() => p.onVersion(c.version)}
              title={c.changes.join('\n')}
            >
              {c.version}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="label">单步验收</span>
        <button className="btn primary" onClick={p.onStep} disabled={p.running || p.currentIndex >= STEP_ORDER.length - 1}>
          单步执行 → {p.currentIndex < STEP_ORDER.length - 1 ? STEP_META[p.currentIndex + 1]?.title.replace(/^[①②③④⑤⑥]\s*/, '') : '完成'}
        </button>
        {p.running ? (
          <button className="btn danger" onClick={p.onStop}>停止自动</button>
        ) : (
          <button className="btn" onClick={p.onAuto}>自动运行全部</button>
        )}
      </div>

      <div className="group">
        <span className="label">历史</span>
        <button className="btn" onClick={p.onUndo} disabled={!p.canUndo} title="撤销上一次配置变更">↶ 撤销</button>
        <button className="btn" onClick={p.onRedo} disabled={!p.canRedo} title="重做">↷ 重做</button>
        <button className="btn danger" onClick={p.onReset}>重置</button>
      </div>

      <div className="group">
        <button className="btn" onClick={p.onSuites} disabled={p.suitesRunning}>
          {p.suitesRunning ? '套件执行中…' : '跑边界套件（升级/重挂载/隔离）'}
        </button>
      </div>

      <div className="group" style={{ flexBasis: '100%' }}>
        <span className="label">故障注入</span>
        {FAULTS.map((f) => {
          const on = p.config.faults.includes(f.key)
          return (
            <label key={f.key} className={`chip ${on ? 'on' : ''}`} title={f.detail}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => p.onToggleFault(f.key)}
              />
              {f.label}
            </label>
          )
        })}
      </div>
    </div>
  )
}
