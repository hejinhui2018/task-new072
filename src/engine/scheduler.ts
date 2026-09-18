/**
 * 确定性帧调度模拟器（纯函数，无随机数、无时钟依赖）。
 *
 * 模型约定：
 * - 时间被离散为 tick（1 tick = TICK_MS = 0.1ms）的整数，避免浮点误差；
 * - 第 i 帧的 vsync 窗口为 [i*B, (i+1)*B)，B = frameBudget（默认 160 tick = 16ms）；
 * - 每个窗口只处理“帧首 vsync 时刻已在队列中”的任务，窗口内到达的任务下一帧才可见；
 * - 任务按 (优先级, 到达帧, id) 排序选取；
 * - 只有比一整帧预算还大的可取消任务才会被帧边界切片抢占；
 *   短于一帧但塞不进当前剩余时间的任务整任务推迟，让后续更短任务填洞；
 * - 不可取消任务原子执行，一旦开始即使越过 vsync 截止线也要跑完 → 长任务；
 * - 空闲帧会把主线程时钟对齐到帧边界（时间线按墙钟时间定位，空档即空闲）；
 * - 掉帧判定：帧首主线程仍忙（上一帧溢出）或帧末主线程越过窗口截止线。
 */
import {
  CancelResultKind,
  CancelResultRecord,
  CancelSpec,
  FrameRecord,
  DropReason,
  FRAME_BUDGET_MS,
  PRIORITY_RANK,
  SimulationInput,
  SimulationResult,
  SliceRecord,
  TaskOutcome,
  TaskSpec,
  TICK_MS,
} from './types'

export const msToTick = (ms: number): number => Math.round(ms / TICK_MS)
export const tickToMs = (tick: number): number => Math.round(tick * TICK_MS * 10) / 10

interface RuntimeState {
  spec: TaskSpec
  totalTick: number
  executedTick: number
  status: TaskOutcome['status']
  startedTick: number | null
  endedTick: number | null
  longTask: boolean
  preemptions: number
  deferredTurns: number
  wastedTick: number
  savedTick: number
  partiallyCanceled: boolean
}

function validate(input: SimulationInput): void {
  const ids = new Set<string>()
  for (const t of input.tasks) {
    if (ids.has(t.id)) throw new Error(`任务 id 重复：${t.id}`)
    ids.add(t.id)
    if (!(t.durationMs > 0)) throw new Error(`任务 ${t.id} 的耗时必须为正数`)
    if (t.arrivalFrame < 0 || !Number.isInteger(t.arrivalFrame)) {
      throw new Error(`任务 ${t.id} 的到达帧必须为非负整数`)
    }
  }
  if (input.frameBudgetMs !== undefined && !(input.frameBudgetMs > 0)) {
    throw new Error('帧预算必须为正数')
  }
}

function pickReady(states: Map<string, RuntimeState>, skip: Set<string>): RuntimeState | null {
  let best: RuntimeState | null = null
  for (const s of states.values()) {
    if (s.status !== 'ready' || skip.has(s.spec.id)) continue
    if (
      best === null ||
      PRIORITY_RANK[s.spec.priority] < PRIORITY_RANK[best.spec.priority] ||
      (PRIORITY_RANK[s.spec.priority] === PRIORITY_RANK[best.spec.priority] &&
        (s.spec.arrivalFrame < best.spec.arrivalFrame ||
          (s.spec.arrivalFrame === best.spec.arrivalFrame && s.spec.id < best.spec.id)))
    ) {
      best = s
    }
  }
  return best
}

function cancelKindFor(state: RuntimeState | undefined): CancelResultKind {
  if (!state) return 'rejected-not-found'
  // 任务尚未到达（还没进入队列），取消请求无的放矢
  if (state.status === 'pending') return 'rejected-not-found'
  if (state.status === 'done' || state.status === 'canceled') return 'rejected-complete'
  if (!state.spec.cancelable) return 'rejected-uncancelable'
  return state.executedTick > 0 ? 'cancelled-partial' : 'cancelled'
}

/**
 * 执行一次完整模拟。相同输入永远得到相同输出（确定性重放）。
 */
export function simulate(input: SimulationInput): SimulationResult {
  validate(input)
  const budgetMs = input.frameBudgetMs ?? FRAME_BUDGET_MS
  const B = msToTick(budgetMs)

  const states = new Map<string, RuntimeState>()
  for (const spec of input.tasks) {
    states.set(spec.id, {
      spec,
      totalTick: msToTick(spec.durationMs),
      executedTick: 0,
      status: 'pending',
      startedTick: null,
      endedTick: null,
      longTask: false,
      preemptions: 0,
      deferredTurns: 0,
      wastedTick: 0,
      savedTick: 0,
      partiallyCanceled: false,
    })
  }
  const cancelsByFrame = new Map<number, CancelSpec[]>()
  for (const c of input.cancels ?? []) {
    const list = cancelsByFrame.get(c.atFrame) ?? []
    list.push(c)
    cancelsByFrame.set(c.atFrame, list)
  }

  const frames: FrameRecord[] = []
  let now = 0
  let frameIndex = 0
  /** 最近一个引发溢出的长任务所在帧，用于标注后续被阻塞帧的来源 */
  let overflowSourceFrame: number | null = null

  const allTerminal = () => {
    for (const s of states.values()) {
      if (s.status !== 'done' && s.status !== 'canceled') return false
    }
    return true
  }

  for (;;) {
    const windowStart = frameIndex * B
    const windowEnd = windowStart + B
    // 帧首时仍在生效的溢出来源（本帧的 dropReasons 用这个快照来归因）
    const overflowAtStart = overflowSourceFrame

    // —— 帧首事件：到达 ——
    const arrivals: string[] = []
    for (const s of states.values()) {
      if (s.status === 'pending' && s.spec.arrivalFrame === frameIndex) {
        s.status = 'ready'
        arrivals.push(s.spec.id)
      }
    }

    // —— 帧首事件：取消请求（在本帧调度之前裁决）——
    const cancelResults: CancelResultRecord[] = []
    for (const c of cancelsByFrame.get(frameIndex) ?? []) {
      const state = states.get(c.taskId)
      const kind = cancelKindFor(state)
      cancelResults.push({ taskId: c.taskId, kind })
      if (!state) continue
      if (kind === 'cancelled' || kind === 'cancelled-partial') {
        // 只在真正执行过的时候才有开始时间；endedTick 记录从队列移除的时刻
        state.endedTick = windowStart
        state.wastedTick = state.executedTick
        state.savedTick = state.totalTick - state.executedTick
        state.partiallyCanceled = kind === 'cancelled-partial'
        state.status = 'canceled'
      }
    }

    const hasFutureArrivals = [...states.values()].some(
      (s) => s.status === 'pending' && s.spec.arrivalFrame > frameIndex,
    )
    const hasFutureCancels = [...cancelsByFrame.keys()].some((f) => f > frameIndex)
    if (
      arrivals.length === 0 &&
      cancelResults.length === 0 &&
      !hasFutureArrivals &&
      !hasFutureCancels &&
      allTerminal() &&
      now <= windowStart
    ) {
      // 没有事件、没有未来事件、全部终态、且帧首主线程已空闲 → 时间线结束。
      // now > windowStart 表示帧首仍被上一帧长任务占着，即便没有事件也要记录该掉帧。
      break
    }

    const threadStartTick = now
    const slices: SliceRecord[] = []
    const deferred: string[] = []
    /** 本帧已经因“塞不进剩余时间”而被推迟过的任务，避免重复选取 */
    const skipped = new Set<string>()
    /** 本帧实际在主线程上运行过的任务 */
    const ran = new Set<string>()
    const readyAtStart: RuntimeState[] = []
    for (const s of states.values()) if (s.status === 'ready') readyAtStart.push(s)

    if (now >= windowEnd) {
      // 整帧被上一帧的长任务占满，本帧没有任何调度机会
      for (const s of readyAtStart) {
        s.deferredTurns++
        deferred.push(s.spec.id)
      }
    } else {
      while (now < windowEnd) {
        const head = pickReady(states, skipped)
        if (!head) break
        const remain = head.totalTick - head.executedTick
        const avail = windowEnd - now
        if (head.startedTick === null) head.startedTick = now

        if (remain <= avail) {
          // 剩余工作在预算内跑完
          slices.push({
            taskId: head.spec.id,
            startTick: now,
            endTick: now + remain,
            longTask: false,
            preempted: false,
            completed: true,
          })
          now += remain
          head.executedTick += remain
          head.status = 'done'
          head.endedTick = now
          ran.add(head.spec.id)
        } else if (remain > B && head.spec.cancelable) {
          // 任务比一整帧还大且可协作：用完本帧剩余预算，在帧边界被抢占，下帧继续
          slices.push({
            taskId: head.spec.id,
            startTick: now,
            endTick: windowEnd,
            longTask: false,
            preempted: true,
            completed: false,
          })
          head.executedTick += avail
          head.preemptions++
          now = windowEnd
          ran.add(head.spec.id)
        } else if (remain > B) {
          // 比一整帧还大又不可取消：原子执行到完，越过 vsync 截止线 → 长任务
          slices.push({
            taskId: head.spec.id,
            startTick: now,
            endTick: now + remain,
            longTask: true,
            preempted: false,
            completed: true,
          })
          now += remain
          head.executedTick = head.totalTick
          head.status = 'done'
          head.endedTick = now
          head.longTask = true
          ran.add(head.spec.id)
          overflowSourceFrame = frameIndex
        } else {
          // remain <= B 但塞不进当前剩余时间：整个任务推迟到下一帧，
          // 继续尝试队列后面更短的任务填洞
          skipped.add(head.spec.id)
        }
      }

      // 帧首就绪、但本帧一 tick 都没轮到的任务 → 被推迟
      for (const s of readyAtStart) {
        if (s.status === 'ready' && !ran.has(s.spec.id)) {
          deferred.push(s.spec.id)
          s.deferredTurns++
        }
      }
    }

    // 帧末主线程空闲：把时钟对齐到帧边界，让后续到达任务按墙钟时间定位
    if (now < windowEnd) now = windowEnd

    const threadEndTick = now
    if (threadEndTick <= windowEnd && overflowSourceFrame !== null) {
      // 主线程已在当前窗口内重新空闲，溢出影响结束
      overflowSourceFrame = null
    }

    const dropReasons: DropReason[] = []
    const ownLongTask = slices.find((sl) => sl.longTask)
    if (ownLongTask) {
      dropReasons.push({ type: 'long-task', taskId: ownLongTask.taskId })
    } else if (threadStartTick > windowStart && overflowAtStart !== null) {
      dropReasons.push({ type: 'overflow-from', frame: overflowAtStart })
    }
    // 帧首仍忙（上帧溢出）或帧末越界 → 本帧 vsync 拿不到新画面
    const dropped = threadStartTick > windowStart || threadEndTick > windowEnd
    const blocked = threadStartTick >= windowEnd

    const frame: FrameRecord = {
      index: frameIndex,
      windowStartTick: windowStart,
      windowEndTick: windowEnd,
      threadStartTick,
      threadEndTick: now,
      // 与输入数组顺序解耦：按 (到达帧, id) 稳定输出，保证确定性重放
      arrivals: [...arrivals].sort(),
      cancelResults: [...cancelResults].sort((a, b) =>
        a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
      ),
      slices,
      deferred: [...deferred].sort(),
      blocked,
      dropped,
      dropReasons,
    }
    frames.push(frame)
    frameIndex++
  }

  // 按终态时间排序，保证输入顺序不影响 outcomes（确定性）；同刻按 id
  const outcomes: TaskOutcome[] = input.tasks
    .map((spec) => {
      const s = states.get(spec.id)!
      return {
        id: spec.id,
        label: spec.label,
        status: s.status,
        startedTick: s.startedTick,
        endedTick: s.endedTick,
        executedMs: tickToMs(s.executedTick),
        wastedMs: tickToMs(s.wastedTick),
        savedMs: tickToMs(s.savedTick),
        longTask: s.longTask,
        preemptions: s.preemptions,
        deferredTurns: s.deferredTurns,
        partiallyCanceled: s.partiallyCanceled,
      }
    })
    .sort((a, b) => (a.endedTick ?? -1) - (b.endedTick ?? -1) || (a.id < b.id ? -1 : 1))

  const droppedFrames = frames.filter((f) => f.dropped).map((f) => f.index)
  const completionTick = outcomes.reduce((m, o) => Math.max(m, o.endedTick ?? 0), 0)
  const totalMainThreadTick = frames.reduce(
    (sum, f) => sum + f.slices.reduce((s, sl) => s + (sl.endTick - sl.startTick), 0),
    0,
  )
  const longTaskCount = frames.reduce((n, f) => n + f.slices.filter((sl) => sl.longTask).length, 0)
  const deferredCount = frames.reduce((n, f) => n + f.deferred.length, 0)
  const preemptedSliceCount = frames.reduce(
    (n, f) => n + f.slices.filter((sl) => sl.preempted).length,
    0,
  )

  return {
    budgetMs,
    budgetTick: B,
    frames,
    outcomes,
    stats: {
      frameCount: frames.length,
      droppedFrames,
      droppedCount: droppedFrames.length,
      longTaskCount,
      deferredCount,
      preemptedSliceCount,
      completionTimeMs: tickToMs(completionTick),
      completionFrame: input.tasks.length === 0 ? 0 : Math.max(1, Math.ceil(completionTick / B)),
      totalMainThreadMs: tickToMs(totalMainThreadTick),
      savedMsByCancel: tickToMs(outcomes.reduce((s, o) => s + msToTick(o.savedMs), 0)),
      wastedMsByCancel: tickToMs(outcomes.reduce((s, o) => s + msToTick(o.wastedMs), 0)),
    },
  }
}
