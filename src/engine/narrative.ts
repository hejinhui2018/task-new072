/**
 * 把模拟结果翻译成“巡检结论”，纯函数、与 UI 无关。
 * 每条结论带语气色，但颜色永远配合文字一起出现（不单靠颜色表意）。
 */
import { tickToMs } from './scheduler'
import { CANCEL_RESULT_LABEL, SimulationResult } from './types'

export type Tone = 'bad' | 'warn' | 'good' | 'info'

export interface Narration {
  id: string
  tone: Tone
  text: string
}

export function buildNarrations(r: SimulationResult): Narration[] {
  const out: Narration[] = []
  const taskLabel = new Map(r.outcomes.map((o) => [o.id, o.label]))

  // 1) 每个长任务：它直接导致了哪些帧掉帧
  for (const f of r.frames) {
    const long = f.slices.find((s) => s.longTask)
    if (!long) continue
    const duration = tickToMs(long.endTick - long.startTick)
    const excess = duration - r.budgetMs
    const affected = r.frames
      .filter(
        (g) =>
          g !== f &&
          g.dropReasons.some((d) => d.type === 'overflow-from' && d.frame === f.index),
      )
      .map((g) => g.index)
    const tail =
      affected.length > 0
        ? `，溢出继续波及第 ${affected.join('、')} 帧`
        : ''
    out.push({
      id: `long-${f.index}`,
      tone: 'bad',
      text:
        `第 ${f.index} 帧「${taskLabel.get(long.taskId)}」是长任务：不可中断，原子执行 ${duration.toFixed(1)}ms，` +
        `超出 ${r.budgetMs}ms 预算 ${excess.toFixed(1)}ms${tail}。这些帧的 vsync 都拿不到新画面。`,
    })
  }

  // 2) 推迟
  for (const o of r.outcomes) {
    if (o.deferredTurns === 0) continue
    const frames = r.frames.filter((f) => f.deferred.includes(o.id)).map((f) => f.index)
    out.push({
      id: `defer-${o.id}`,
      tone: 'warn',
      text:
        `「${o.label}」在第 ${frames.join('、')} 帧因剩余预算不足被整任务推迟（共 ${o.deferredTurns} 次），` +
        `开始时间后移，但推迟本身不产生掉帧。`,
    })
  }

  // 3) 协作抢占
  for (const o of r.outcomes) {
    if (o.preemptions === 0) continue
    out.push({
      id: `preempt-${o.id}`,
      tone: 'good',
      text:
        `「${o.label}」可协作让出：在帧边界被切片 ${o.preemptions} 次，每段都在 ${r.budgetMs}ms 预算内结束，` +
        `没有引发掉帧，最终在第 ${o.endedTick === null ? '?' : Math.floor(o.endedTick / r.budgetTick)} 帧窗口内跑完。`,
    })
  }

  // 4) 取消裁决
  for (const f of r.frames) {
    for (const c of f.cancelResults) {
      const label = taskLabel.get(c.taskId) ?? c.taskId
      if (c.kind === 'cancelled') {
        const saved = r.outcomes.find((o) => o.id === c.taskId)?.savedMs ?? 0
        out.push({
          id: `cancel-${f.index}-${c.taskId}`,
          tone: 'good',
          text: `第 ${f.index} 帧请求取消「${label}」→ ${CANCEL_RESULT_LABEL[c.kind]}，为主线程节省 ${saved}ms。`,
        })
      } else if (c.kind === 'cancelled-partial') {
        const o = r.outcomes.find((x) => x.id === c.taskId)
        out.push({
          id: `cancel-${f.index}-${c.taskId}`,
          tone: 'warn',
          text:
            `第 ${f.index} 帧请求取消「${label}」→ ${CANCEL_RESULT_LABEL[c.kind]}：` +
            `已白跑 ${o?.wastedMs ?? 0}ms，剩余 ${o?.savedMs ?? 0}ms 不再占用主线程。`,
        })
      } else {
        out.push({
          id: `cancel-${f.index}-${c.taskId}`,
          tone: 'bad',
          text: `第 ${f.index} 帧请求取消「${label}」→ ${CANCEL_RESULT_LABEL[c.kind]}，任务继续执行。`,
        })
      }
    }
  }

  // 5) 汇总结论
  if (r.stats.droppedCount === 0) {
    out.push({
      id: 'summary',
      tone: 'good',
      text:
        `全部 ${r.outcomes.length} 个任务在 ${r.stats.completionTimeMs.toFixed(1)}ms（${r.stats.completionFrame} 帧）内结束，` +
        `每帧都没有越过 ${r.budgetMs}ms vsync 线，未掉帧。`,
    })
  } else {
    out.push({
      id: 'summary',
      tone: 'bad',
      text:
        `共掉帧 ${r.stats.droppedCount} 帧（帧号 ${r.stats.droppedFrames.join('、')}），` +
        `全部工作 ${r.stats.completionTimeMs.toFixed(1)}ms 才结束（${r.stats.completionFrame} 帧）。` +
        `掉帧帧号已在上方时间线标出。`,
    })
  }

  return out
}
