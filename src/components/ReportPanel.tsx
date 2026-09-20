import { useState } from 'react'
import type { CheckId, StepResult } from '../contract/types'
import { getContract } from '../contract/versions'
import { STEP_META, overallVerdict } from '../engine/runChecks'
import { VerdictBadge } from './VerdictBadge'

interface Props {
  version: string
  results: Partial<Record<CheckId, StepResult>>
  currentStep: CheckId
  onSelect: (id: CheckId) => void
}

export function ReportPanel({ version, results, currentStep, onSelect }: Props) {
  const [open, setOpen] = useState<CheckId | null>('events')
  const overall = overallVerdict(results)

  return (
    <div className="panel scroll-body" data-testid="report-panel">
      <div className="panel-h">
        验收报告
        <span className="tagline">宿主契约固定 v1 · 当前元素 {version}</span>
        <span style={{ marginLeft: 'auto' }}>
          <VerdictBadge verdict={overall} />
        </span>
      </div>
      <div className="panel-b">
        <ContractDigest version={version} />

        {STEP_META.map((meta, i) => {
          const r = results[meta.id]
          const isOpen = open === meta.id
          const isCurrent = currentStep === meta.id
          return (
            <div key={meta.id} className={`step ${r?.stale ? 'stale' : ''}`}>
              <div
                className="step-h"
                onClick={() => {
                  setOpen(isOpen ? null : meta.id)
                  onSelect(meta.id)
                }}
              >
                <span className="t">
                  {meta.title}
                  {isCurrent && <span className="mini"> · 当前位置</span>}
                </span>
                {r?.stale && <span className="mini" title="刷新恢复的历史快照">快照</span>}
                <VerdictBadge verdict={r?.verdict ?? null} mini />
                <span className="caret">{isOpen ? '▾' : '▸'}</span>
                <span className="mini">{i + 1}/6</span>
              </div>
              {isOpen && (
                <StepBody r={r} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StepBody({ r }: { r?: StepResult }) {
  if (!r) return <div className="panel-b"><div className="empty">尚未执行到这一步。点击步骤标题可把验收重放到此处。</div></div>
  return (
    <div className="step-b">
      <div className="principle">{r.principle}</div>

      <div className="kv">
        <div className="k">期望</div>
        <div className="expected">{r.expected}</div>
      </div>

      <ul className="as">
        {r.assertions.map((a, i) => (
          <li key={i}>
            <span className="an">
              {a.name}
              <div className="mini">
                期望：{a.expected}
                <br />
                实际：{a.actual}
              </div>
            </span>
            <span className="av"><VerdictBadge verdict={a.verdict} mini /></span>
          </li>
        ))}
      </ul>

      <div className={`actual ${r.verdict}`}>
        <strong>结论解释：</strong>{r.actual}
      </div>

      {r.adaptationTrace && r.adaptationTrace.length > 0 && (
        <div className="trace">
          <div className="th">兼容适配痕迹（与静默丢失的区分依据）</div>
          {r.adaptationTrace.map((t, i) => (
            <div key={i}>• {t}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function ContractDigest({ version }: { version: string }) {
  const c = getContract(version)
  return (
    <div className="probe-section">
      <h4>{c.label} · 契约清单</h4>
      <table className="tight">
        <tbody>
          <tr><th>slots</th><td>
            {c.slots.map((s) => (
              <span key={s.name || '$default'} className={`pill ${s.renamedFrom ? 'bad' : 'good'}`}>
                {s.name || '(default)'}{s.renamedFrom ? ` ← ${s.renamedFrom}` : ''}
              </span>
            ))}
          </td></tr>
          <tr><th>attrs</th><td>
            {c.attributes.map((a) => (
              <span key={a.name} className={`pill ${a.renamedFrom ? 'bad' : 'good'}`}>
                {a.name}{a.renamedFrom ? ` ← ${a.renamedFrom}` : ''}
              </span>
            ))}
          </td></tr>
          <tr><th>props</th><td>
            {c.properties.map((p) => (
              <span key={p.name} className={`pill ${p.renamedFrom ? 'bad' : 'good'}`}>
                {p.name}{p.renamedFrom ? ` ← ${p.renamedFrom}` : ''}
              </span>
            ))}
          </td></tr>
          <tr><th>events</th><td>
            {c.events.map((e) => (
              <span key={e.name} className={`pill ${e.renamedFrom || !e.composed ? 'bad' : 'good'}`}>
                {e.name}(bubble:{e.bubbles ? 1 : 0}, composed:{e.composed ? 1 : 0})
                {e.renamedFrom ? ` ← ${e.renamedFrom}` : ''}
              </span>
            ))}
          </td></tr>
          <tr><th>parts</th><td>
            {c.parts.map((p) => (
              <span key={p.name} className={`pill ${p.renamedFrom ? 'bad' : 'good'}`}>
                {p.name}{p.renamedFrom ? ` ← ${p.renamedFrom}` : ''}
              </span>
            ))}
          </td></tr>
        </tbody>
      </table>
      <details className="mini" style={{ marginTop: 6 }}>
        <summary>相对 v1 的变更</summary>
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {c.changes.map((ch, i) => <li key={i}>{ch}</li>)}
        </ul>
      </details>
    </div>
  )
}
