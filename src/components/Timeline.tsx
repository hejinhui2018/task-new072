import { useState } from 'react'
import { tickToMs } from '../engine/scheduler'
import { CANCEL_RESULT_LABEL, SimulationResult, TASK_KIND_LABEL, TaskKind } from '../engine/types'

export const KIND_SWATCH: Record<TaskKind, string> = {
  decode: '#3987e5',
  layout: '#d95926',
  log: '#199e70',
  preload: '#c98500',
  custom: '#9085e9',
}

interface Tip {
  x: number
  y: number
  title: string
  lines: string[]
}

const fmt = (tick: number) => tickToMs(tick).toFixed(1)

interface Props {
  result: SimulationResult
  kindById: Record<string, TaskKind>
  cursor: number
  selectedFrame: number | null
  onSelectFrame: (i: number) => void
  pxPerTick: number
}

export default function Timeline({
  result,
  kindById,
  cursor,
  selectedFrame,
  onSelectFrame,
  pxPerTick,
}: Props) {
  const [tip, setTip] = useState<Tip | null>(null)
  const { frames, budgetTick } = result
  const frameW = budgetTick * pxPerTick
  const totalW = frames.length * frameW
  const H = 138

  const showTip = (e: React.MouseEvent, title: string, lines: string[]) => {
    setTip({ x: e.clientX + 14, y: e.clientY + 14, title, lines })
  }
  const hide = () => setTip(null)

  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ width: Math.max(totalW, 200), height: H }}>
        {/* 帧标尺 */}
        {frames.map((f) => (
          <div
            key={f.index}
            className={
              'frame-ruler' +
              (f.dropped ? ' dropped' : '') +
              (f.blocked ? ' blocked' : '') +
              (selectedFrame === f.index ? ' selected' : '')
            }
            style={{ left: f.index * frameW, width: frameW, opacity: f.index > cursor ? 0.3 : 1 }}
            onClick={() => onSelectFrame(f.index)}
            onMouseMove={(e) =>
              showTip(e, `第 ${f.index} 帧 · ${fmt(f.windowStartTick)}–${fmt(f.windowEndTick)}ms`, [
                f.dropped
                  ? `掉帧：${f.dropReasons
                      .map((d) => (d.type === 'long-task' ? `长任务「${d.taskId}」` : `被第 ${d.frame} 帧溢出阻塞`))
                      .join('；')}`
                  : '在 vsync 前完成本帧工作，未掉帧',
                f.blocked ? '整帧被上一帧长任务占满，没有调度机会' : '',
                f.arrivals.length ? `任务到达：${f.arrivals.join('、')}` : '',
                f.deferred.length ? `任务推迟：${f.deferred.join('、')}` : '',
              ].filter(Boolean))
            }
            onMouseLeave={hide}
          >
            <div className="fr-no">#{f.index}</div>
            <div className="fr-time">
              {fmt(f.windowStartTick)}–{fmt(f.windowEndTick)}ms
            </div>
          </div>
        ))}

        {/* 事件行：到达 ▲ / 取消 ● */}
        <div className="event-row" style={{ left: 0, width: totalW }}>
          {frames.map((f) =>
            f.arrivals.map((id, i) => (
              <span
                key={`a-${f.index}-${id}`}
                className="marker"
                style={{ left: f.index * frameW + 8 + i * 12, opacity: f.index > cursor ? 0.3 : 1 }}
                onMouseMove={(e) => showTip(e, '任务到达', [`「${id}」在第 ${f.index} 帧 vsync 进入队列`])}
                onMouseLeave={hide}
              />
            )),
          )}
          {frames.map((f) =>
            f.cancelResults.map((c, i) => {
              const ok = c.kind === 'cancelled' || c.kind === 'cancelled-partial'
              return (
                <span
                  key={`c-${f.index}-${c.taskId}`}
                  className={'cancel-marker' + (ok ? '' : ' rejected')}
                  style={{ left: f.index * frameW + 8 + (f.arrivals.length + i) * 14, opacity: f.index > cursor ? 0.3 : 1 }}
                  onMouseMove={(e) =>
                    showTip(e, `取消请求 · 第 ${f.index} 帧`, [`任务：${c.taskId}`, `裁决：${CANCEL_RESULT_LABEL[c.kind]}`])
                  }
                  onMouseLeave={hide}
                >
                  {ok ? '✓' : '✕'}
                </span>
              )
            }),
          )}
        </div>

        {/* 主线程占用行 */}
        <div
          className="thread-row"
          style={{
            left: 0,
            width: totalW,
            backgroundImage: 'linear-gradient(to right, var(--grid) 1px, transparent 1px)',
            backgroundSize: `${frameW}px 100%`,
          }}
        >
          {frames.flatMap((f) =>
            f.slices.map((s, i) => {
              const left = s.startTick * pxPerTick
              const width = Math.max((s.endTick - s.startTick) * pxPerTick, 2)
              const kind = kindById[s.taskId] ?? 'custom'
              const wide = width >= 44
              return (
                <div
                  key={`${f.index}-${i}`}
                  className={'slice' + (s.longTask ? ' long' : '') + (s.preempted ? ' preempted' : '')}
                  style={{
                    left,
                    width,
                    background: KIND_SWATCH[kind],
                    opacity: f.index > cursor ? 0.25 : 1,
                  }}
                  onMouseMove={(e) =>
                    showTip(e, s.taskId, [
                      `${TASK_KIND_LABEL[kind]}任务`,
                      `执行区间：${fmt(s.startTick)}–${fmt(s.endTick)}ms（${tickToMs(s.endTick - s.startTick).toFixed(1)}ms）`,
                      s.longTask ? '⚠ 长任务：不可中断，原子执行并越过 vsync 截止线' : '',
                      s.preempted ? '帧边界被抢占，剩余部分下帧继续' : '',
                      s.completed ? '任务在该切片跑完' : '',
                    ].filter(Boolean))
                  }
                  onMouseLeave={hide}
                >
                  {wide ? s.taskId : ''}
                </div>
              )
            }),
          )}
        </div>

        {/* 推迟行 */}
        <div className="deferred-row" style={{ left: 0, width: totalW }}>
          {frames.map((f) =>
            f.deferred.length ? (
              <span
                key={`d-${f.index}`}
                className="defer-chip"
                style={{ left: f.index * frameW + frameW / 2, opacity: f.index > cursor ? 0.3 : 1 }}
                onMouseMove={(e) =>
                  showTip(
                    e,
                    `第 ${f.index} 帧被推迟`,
                    f.deferred.map((id) => `⏸ ${id}（本帧未获执行，下帧再排队）`),
                  )
                }
                onMouseLeave={hide}
              >
                ⏸ {f.deferred.join('、')}
              </span>
            ) : null,
          )}
        </div>

        {/* 播放头：当前时刻的墙钟位置 */}
        {frames.length > 0 && (
          <div className="playhead" style={{ left: Math.min(cursor + 1, frames.length) * frameW, height: H }} />
        )}
      </div>

      {tip && (
        <div
          className="tooltip"
          style={{ left: Math.min(tip.x, window.innerWidth - 300), top: Math.min(tip.y, window.innerHeight - 140) }}
        >
          <b>{tip.title}</b>
          {tip.lines.map((l, i) => (
            <div key={i} className="dim">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Legend({ kinds }: { kinds: TaskKind[] }) {
  return (
    <div className="legend">
      {kinds.map((k) => (
        <span className="legend-item" key={k}>
          <span className="legend-swatch" style={{ background: KIND_SWATCH[k] }} />
          {TASK_KIND_LABEL[k]}
        </span>
      ))}
      <span className="legend-item">
        <span
          className="legend-swatch"
          style={{ background: 'repeating-linear-gradient(-45deg,#e66767 0 3px,#8a3b3b 3px 6px)' }}
        />
        长任务
      </span>
      <span className="legend-item">
        <span style={{ color: 'var(--st-critical)', fontWeight: 700 }}>#</span> 掉帧
      </span>
      <span className="legend-item">
        <span style={{ color: 'var(--st-warning)' }}>●</span> 取消事件
      </span>
      <span className="legend-item">
        <span style={{ color: 'var(--ink-muted)' }}>▲</span> 任务到达
      </span>
      <span className="legend-item">
        <span style={{ color: 'var(--ink-muted)' }}>⏸</span> 推迟
      </span>
    </div>
  )
}
