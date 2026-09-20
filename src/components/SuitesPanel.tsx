import type { SuiteResult } from '../contract/types'
import { VerdictBadge } from './VerdictBadge'
import type { Verdict } from '../contract/types'

const ORDER: Record<Verdict, number> = { pass: 0, adapted: 1, loss: 2, fail: 3 }

export function SuitesPanel({ suites }: { suites: SuiteResult[] | null }) {
  return (
    <div className="panel">
      <div className="panel-h">
        边界套件结果
        <span className="tagline">升级边界 · 重挂载 · 多实例隔离（隐藏舞台中真实执行）</span>
      </div>
      <div className="panel-b">
        {!suites && <div className="empty">点击工具栏“跑边界套件”。每个套件都会新建/销毁真实元素。</div>}
        {suites?.map((s) => {
          const verdicts = s.cases.map((c) => c.verdict)
          const overall = verdicts.reduce<Verdict>((acc, v) => (ORDER[v] > ORDER[acc] ? v : acc), 'pass')
          return (
            <div key={s.id} className={`step ${s.stale ? 'stale' : ''}`} style={{ marginBottom: 12 }}>
              <div className="step-h" style={{ cursor: 'default' }}>
                <span className="t">{s.title}</span>
                {s.stale && <span className="mini">快照</span>}
                <VerdictBadge verdict={overall} mini />
              </div>
              <div className="step-b">
                <div className="principle" style={{ marginBottom: 8 }}>{s.principle}</div>
                {s.cases.map((c, i) => (
                  <div key={i} className="suite-case">
                    <span className="cn">
                      {c.name}
                      <div className="cd">{c.detail}</div>
                    </span>
                    <VerdictBadge verdict={c.verdict} mini />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
