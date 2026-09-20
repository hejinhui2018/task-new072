import type { RefObject } from 'react'
import type { BenchContext } from '../engine/mountBench'
import { getContract } from '../contract/versions'

interface Props {
  stageRef: RefObject<HTMLDivElement>
  liveCtx: BenchContext | null
  version: string
  snapshotMode: boolean
  restoredAt: number | null
}

const HOST_CODE = `// 业务页面代码：自 v1 起从未修改
host.innerHTML = \`
  <slot-card title="我的卡片">
    <span slot="header">旧页面标题</span>
    <p>旧页面正文</p>
  </slot-card>\`
host.addEventListener('card-submit', onSubmit)  // ← 提交回调
host.adoptedStyleSheets = css\`
  slot-card::part(submit-button){ background:#16a34a }\`  // ← 旧 part 样式`

export function HostPanel({ stageRef, liveCtx, version, snapshotMode, restoredAt }: Props) {
  const events = liveCtx?.hostEvents ?? []
  return (
    <div className="col">
      <div className="panel">
        <div className="panel-h">
          业务宿主
          <span className="tagline">light DOM 的所有者 · 事件监听方 · 旧 ::part 样式作者</span>
        </div>
        <div className="panel-b">
          <pre className="code">{HOST_CODE}</pre>
          <div className="mini" style={{ marginBottom: 8 }}>
            宿主永远按 <code>v1</code> 契约写代码。升级后的元素要接入它，靠的是元素自身的向后兼容——而不是回头改宿主。
            当前挂载：<code>{getContract(version).tag}</code>。
          </div>
        </div>
      </div>

      <div className="panel scroll-body" style={{ flex: 1 }}>
        <div className="panel-h">
          宿主事件接收记录
          <span className="tagline">card-submit 监听器的真实命中情况</span>
          <span className="pill" style={{ marginLeft: 'auto' }}>{events.length}</span>
        </div>
        <div className="panel-b">
          {events.length === 0 && (
            <div className="empty">
              还没有事件到达业务宿主。
              {version === 'v2' && ' v2 下点击内部按钮后这里依然为空——这正是“提交事件没有到达宿主”。'}
            </div>
          )}
          {events.map((e, i) => (
            <div className="ev" key={i}>
              <div className="et">✓ {e.type}</div>
              <div className="mini">eventPhase={e.phase}（3=冒泡）· detail={JSON.stringify(e.detail)}</div>
              <div className="ep">path: {e.path}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel scroll-body" style={{ flex: 1 }}>
        <div className="panel-h">
          宿主投影的 light DOM
          <span className="tagline">节点物理上始终在这一侧，slot 只决定渲染位置</span>
        </div>
        <div className="panel-b">
          {snapshotMode ? (
            <div className="empty">快照模式（恢复自 {restoredAt ? new Date(restoredAt).toLocaleString() : ''}）：未挂载真实 DOM，运行任意步骤即恢复现场。</div>
          ) : (
            <div ref={stageRef} />
          )}
          {snapshotMode && <div ref={stageRef} hidden />}
          <div className="mini" style={{ marginTop: 8 }}>
            ↑ 虚线框内是真实文档：业务宿主 <code>div.business-host</code> 包住自定义元素，
            元素内部按钮可直接点击（真实用户事件）。
          </div>
        </div>
      </div>
    </div>
  )
}
