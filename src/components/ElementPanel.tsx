import { useMemo } from 'react'
import type { BenchContext } from '../engine/mountBench'
import { probeCard } from '../engine/mountBench'
import { getInternal } from '../element/createCard'
import { getContract } from '../contract/versions'

export function ElementPanel({ liveCtx }: { liveCtx: BenchContext | null }) {
  // 每次父级 500ms tick 都会重新渲染并重新取探针，保持现场真实
  const probe = useMemo(() => (liveCtx ? probeCard(liveCtx.card) : null), [liveCtx, liveCtx?.runtime.dispatches.length])
  const internal = liveCtx ? getInternal(liveCtx.card) : null

  if (!liveCtx || !probe || !internal) {
    return (
      <div className="panel scroll-body">
        <div className="panel-h">自定义元素现场 <span className="tagline">shadow 两侧探针</span></div>
        <div className="panel-b"><div className="empty">尚未挂载。执行一个验收步骤后这里显示真实元素状态。</div></div>
      </div>
    )
  }

  const contract = getContract(liveCtx.runtime.version)

  return (
    <div className="panel scroll-body">
      <div className="panel-h">
        <code>{probe.instanceId}</code>
        <span className="tagline">{contract.label}</span>
        <span className="pill">{probe.shadowMode}</span>
      </div>
      <div className="panel-b">
        <Section title="Shadow 边界">
          <table className="tight">
            <tbody>
              <tr><th>外部 el.shadowRoot</th><td>{probe.externalShadowRoot ? `${probe.externalShadowRoot.mode}（${probe.externalShadowRoot.childCount} 子节点）` : <b className="loss-text">null</b>}</td></tr>
              <tr><th>connected</th><td>{String(probe.connected)}</td></tr>
              <tr><th>内部按钮 part</th><td className="mono">[{probe.parts.join(', ') || '∅'}]</td></tr>
              <tr><th>按钮计算背景</th><td className="mono">{probe.buttonBg}</td></tr>
            </tbody>
          </table>
        </Section>

        <Section title="Slot 分配（投影实况）">
          <table className="tight">
            <thead><tr><th>shadow 内 slot</th><th>assigned light 节点</th><th>flatten 后实际渲染</th><th>回退</th></tr></thead>
            <tbody>
              {probe.slots.map((s, i) => (
                <tr key={i}>
                  <td className="mono">{s.name}</td>
                  <td>{s.assigned.length ? s.assigned.map((n, j) => <div key={j} className="mono">{n}</div>) : <span className="mini">∅</span>}</td>
                  <td>{s.flattened.map((n, j) => <div key={j} className="mono">{n}</div>)}</td>
                  <td>{s.fallbackShown ? '显示回退' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {probe.unassignedSlotted.length > 0 && (
            <div className="trace" style={{ marginTop: 8 }}>
              <div className="th">检测到无人接收的投影节点（静默丢失证据）</div>
              {probe.unassignedSlotted.map((l, i) => (
                <div key={i} className="mono">
                  &lt;{l.tag} slot=&quot;{l.slot}&quot;&gt; {l.text} —— 在 light DOM 中存在，但无 slot 接收，永不渲染
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Attributes / Properties">
          <table className="tight">
            <thead><tr><th>面</th><th>名称</th><th>值</th><th>组件级访问器</th></tr></thead>
            <tbody>
              {probe.attributes.map((a, i) => (
                <tr key={i}><td>attr</td><td className="mono">{a.name}</td><td className="mono">"{a.value}"</td><td>—</td></tr>
              ))}
              {Object.entries(probe.props).map(([name, p]) => (
                <tr key={name}>
                  <td>prop</td>
                  <td className="mono">{name}</td>
                  <td className="mono">{JSON.stringify(p.value)}</td>
                  <td>{p.exists ? '是' : <span className="loss-text">否（落到原型链）</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="内部事件派发回执">
          {probe.dispatches.length === 0 && <div className="empty">还未点击提交按钮（可直接点舞台上元素的“提交”）。</div>}
          <table className="tight">
            <thead><tr><th>事件</th><th>composed</th><th>派发点</th><th>到达 host</th><th>通道</th></tr></thead>
            <tbody>
              {probe.dispatches.map((d, i) => (
                <tr key={i}>
                  <td className="mono">{d.event}</td>
                  <td className="mono">{String(d.composed)}</td>
                  <td className="mono">{d.target}</td>
                  <td>{d.stopped ? <span className="loss-text">否</span> : '是'}</td>
                  <td className="mono">{d.via ?? '原生'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="probe-section">
      <h4>{title}</h4>
      {children}
    </div>
  )
}
