import {
  CANCEL_RESULT_LABEL,
  PRIORITY_LABEL,
  Priority,
  SimulationResult,
  TaskSpec,
  TaskStatus,
} from '../engine/types'
import { tickToMs } from '../engine/scheduler'

const t = (tick: number) => tickToMs(tick).toFixed(1)

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '未到达',
  ready: '就绪等待',
  running: '运行中',
  done: '已完成',
  canceled: '已取消',
}

export function FrameInspector({
  result,
  frameIndex,
}: {
  result: SimulationResult
  frameIndex: number | null
}) {
  const f = frameIndex === null ? null : result.frames.find((x) => x.index === frameIndex) ?? null
  const nameOf = (id: string) => result.outcomes.find((o) => o.id === id)?.label ?? id

  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <h2 className="panel-title">帧检视器</h2>
      {!f ? (
        <p className="scenario-desc">点击上方时间线中的任意一帧，查看该 vsync 窗口内的到达、取消裁决、主线程切片与推迟明细。</p>
      ) : (
        <div className="detail-section">
          <h3>
            第 {f.index} 帧{' '}
            {f.dropped ? (
              <span className="badge long">掉帧</span>
            ) : (
              <span className="badge done">准时</span>
            )}
            {f.blocked && <span className="badge long">整帧阻塞</span>}
          </h3>
          <div className="kv-line">
            <span className="k">vsync 窗口：</span>
            {t(f.windowStartTick)}–{t(f.windowEndTick)}ms（预算 {result.budgetMs}ms）
          </div>
          <div className="kv-line">
            <span className="k">主线程时钟：</span>
            帧首 {t(f.threadStartTick)}ms → 帧末 {t(f.threadEndTick)}ms
          </div>
          {f.dropReasons.map((d, i) => (
            <div key={i} className="kv-line" style={{ color: 'var(--st-critical)' }}>
              {d.type === 'long-task'
                ? `⚠ 长任务「${nameOf(d.taskId)}」越过截止线 ${t(f.threadEndTick - f.windowEndTick)}ms`
                : `⚠ 第 ${d.frame} 帧的长任务溢出占用本帧窗口`}
            </div>
          ))}

          <div className="kv-line" style={{ marginTop: 6 }}>
            <span className="k">帧首到达（{f.arrivals.length}）：</span>
            {f.arrivals.length ? f.arrivals.map(nameOf).join('、') : '—'}
          </div>
          <div className="kv-line">
            <span className="k">取消裁决（{f.cancelResults.length}）：</span>
          </div>
          {f.cancelResults.length === 0 ? (
            <div className="kv-line">—</div>
          ) : (
            f.cancelResults.map((c, i) => {
              const rejected = c.kind.startsWith('rejected')
              return (
                <div key={i} className="kv-line">
                  「{nameOf(c.taskId)}」→{' '}
                  <span className={rejected ? 'badge cancel-no' : 'badge cancel-ok'}>
                    {CANCEL_RESULT_LABEL[c.kind]}
                  </span>
                </div>
              )
            })
          )}

          <div className="kv-line" style={{ marginTop: 6 }}>
            <span className="k">主线程切片（{f.slices.length}）：</span>
          </div>
          {f.slices.length === 0 ? (
            <div className="kv-line">本帧主线程空闲{ f.blocked ? '（被上一帧长任务占满）' : ''}</div>
          ) : (
            f.slices.map((s, i) => (
              <div key={i} className="kv-line">
                「{nameOf(s.taskId)}」{t(s.startTick)}–{t(s.endTick)}ms
                {s.longTask && <span className="badge long">长任务</span>}
                {s.preempted && <span className="badge preempt">帧边界抢占</span>}
                {s.completed && <span className="badge done">完成</span>}
              </div>
            ))
          )}

          <div className="kv-line" style={{ marginTop: 6 }}>
            <span className="k">被推迟（{f.deferred.length}）：</span>
            {f.deferred.length ? f.deferred.map(nameOf).join('、') : '—'}
          </div>
        </div>
      )}
    </div>
  )
}

export function OutcomesTable({
  result,
  tasks,
}: {
  result: SimulationResult
  tasks: TaskSpec[]
}) {
  const priorityOf = new Map(tasks.map((t) => [t.id, t.priority as Priority]))
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h2 className="panel-title">任务结算</h2>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11.5,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <thead>
            <tr style={{ color: 'var(--ink-muted)', textAlign: 'left' }}>
              <th style={{ padding: '3px 6px', fontWeight: 400 }}>任务</th>
              <th style={{ padding: '3px 6px', fontWeight: 400 }}>优先级</th>
              <th style={{ padding: '3px 6px', fontWeight: 400 }}>结果</th>
              <th style={{ padding: '3px 6px', fontWeight: 400 }}>实跑</th>
              <th style={{ padding: '3px 6px', fontWeight: 400 }}>让出/推迟</th>
            </tr>
          </thead>
          <tbody>
            {result.outcomes.map((o) => {
              const canceled = o.status === 'canceled'
              return (
                <tr
                  key={o.id}
                  style={{ borderTop: '1px solid var(--border)', opacity: canceled ? 0.7 : 1 }}
                >
                  <td style={{ padding: '4px 6px' }}>
                    {o.label}
                    {o.longTask && <span className="badge long">长任务</span>}
                  </td>
                  <td style={{ padding: '4px 6px', color: 'var(--ink-2)' }}>
                    {(() => {
                      const p = priorityOf.get(o.id)
                      return p ? PRIORITY_LABEL[p] : '—'
                    })()}
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    {canceled ? (
                      <span className="badge cancel-ok">
                        {o.partiallyCanceled
                          ? `部分取消（白跑 ${o.wastedMs}ms，省 ${o.savedMs}ms）`
                          : `已取消（省 ${o.savedMs}ms）`}
                      </span>
                    ) : (
                      <span className="badge done">{STATUS_LABEL[o.status]}</span>
                    )}
                  </td>
                  <td style={{ padding: '4px 6px' }}>{o.executedMs.toFixed(1)}ms</td>
                  <td style={{ padding: '4px 6px', color: 'var(--ink-muted)' }}>
                    {o.preemptions > 0 && `让出 ${o.preemptions} 次`}
                    {o.preemptions > 0 && o.deferredTurns > 0 && ' · '}
                    {o.deferredTurns > 0 && `推迟 ${o.deferredTurns} 次`}
                    {o.preemptions === 0 && o.deferredTurns === 0 && '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
