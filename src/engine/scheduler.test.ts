import { describe, expect, it } from 'vitest'
import { msToTick, simulate, tickToMs } from './scheduler'
import { SWITCH_LIVE_SCENARIO } from './scenarios'
import { CancelSpec, SimulationInput, TaskSpec } from './types'

let seq = 0
function task(partial: Partial<TaskSpec> & Pick<TaskSpec, 'label' | 'durationMs'>): TaskSpec {
  seq += 1
  return {
    id: partial.id ?? `t${seq}`,
    kind: partial.kind ?? 'custom',
    priority: partial.priority ?? 'normal',
    arrivalFrame: partial.arrivalFrame ?? 0,
    cancelable: partial.cancelable ?? true,
    ...partial,
  }
}

function run(tasks: TaskSpec[], cancels?: CancelSpec[], frameBudgetMs?: number) {
  return simulate({ tasks, cancels, frameBudgetMs })
}

describe('时间单位换算（确定性整数运算）', () => {
  it('ms 与 tick 互转不产生浮点漂移', () => {
    expect(msToTick(16)).toBe(160)
    expect(msToTick(0.1)).toBe(1)
    expect(msToTick(22.3)).toBe(223)
    expect(tickToMs(160)).toBe(16)
    expect(tickToMs(7)).toBe(0.7)
  })
})

describe('帧预算（16ms）', () => {
  it('恰好 16ms 的可取消任务在一帧内完成且不掉帧', () => {
    const r = run([task({ label: 'a', durationMs: 16 })])
    expect(r.frames).toHaveLength(1)
    expect(r.frames[0].dropped).toBe(false)
    expect(r.stats.droppedCount).toBe(0)
    expect(r.stats.completionTimeMs).toBe(16)
    expect(r.outcomes[0].status).toBe('done')
  })

  it('超过预算的可取消任务被切片到后续帧，不算长任务', () => {
    const r = run([task({ label: 'a', durationMs: 16.1 })])
    expect(r.frames.length).toBeGreaterThan(1)
    expect(r.frames[0].slices[0]).toMatchObject({ preempted: true, longTask: false })
    expect(r.stats.longTaskCount).toBe(0)
    expect(r.stats.completionTimeMs).toBe(16.1)
  })

  it('空闲帧不入时间线，时间线只记录有事件/有工作的帧', () => {
    const r = run([task({ label: 'late', durationMs: 2, arrivalFrame: 3 })])
    expect(r.frames.map((f) => f.index)).toEqual([0, 1, 2, 3])
    expect(r.frames.slice(0, 3).every((f) => f.slices.length === 0)).toBe(true)
    expect(r.frames[3].slices).toHaveLength(1)
  })

  it('支持自定义帧预算', () => {
    const r = run([task({ label: 'a', durationMs: 8, cancelable: false })], [], 8)
    expect(r.budgetMs).toBe(8)
    expect(r.frames[0].dropped).toBe(false)
  })

  it('非法输入被拒绝', () => {
    expect(() => run([task({ id: 'x', label: 'a', durationMs: 0 })])).toThrow()
    const dup = task({ id: 'x', label: 'a', durationMs: 1 })
    expect(() => run([dup, { ...dup, label: 'b' }])).toThrow(/重复/)
    expect(() => simulate({ tasks: [], frameBudgetMs: 0 })).toThrow()
  })
})

describe('优先级调度', () => {
  it('同帧到达时按优先级取任务（低优先级先排队也没用）', () => {
    const low = task({ id: 'low', label: '低', durationMs: 5, priority: 'low' })
    const critical = task({ id: 'crit', label: '关键', durationMs: 5, priority: 'critical' })
    const r = run([low, critical])
    expect(r.frames[0].slices[0].taskId).toBe('crit')
    expect(r.frames[0].slices[1].taskId).toBe('low')
  })

  it('预算不够时，最低优先级任务被推迟并记录帧号', () => {
    const tasks = [
      task({ id: 'a', label: 'a', durationMs: 7, priority: 'critical' }),
      task({ id: 'b', label: 'b', durationMs: 7, priority: 'high' }),
      task({ id: 'c', label: 'c', durationMs: 7, priority: 'low' }),
    ]
    const r = run(tasks)
    // 7+7=14ms 后只剩 2ms，c 是可取消任务；调度器不会给它切片开头，
    // 因为剩余 2ms 内跑不完且会被抢占 —— 它整任务被推迟到下一帧
    expect(r.frames[0].deferred).toEqual(['c'])
    expect(r.stats.deferredCount).toBeGreaterThanOrEqual(1)
    const outcomeC = r.outcomes.find((o) => o.id === 'c')!
    expect(outcomeC.deferredTurns).toBeGreaterThanOrEqual(1)
    // 推迟不等于抢占：没有产生 preempted 切片
    expect(r.frames[0].slices.every((s) => !s.preempted)).toBe(true)
  })

  it('任务已经开始后不因更高优先级到达而被打断（帧边界才重新排序）', () => {
    const early = task({ id: 'early', label: '先到', durationMs: 10, priority: 'normal' })
    const late = task({
      id: 'late',
      label: '后到关键',
      durationMs: 3,
      priority: 'critical',
      arrivalFrame: 1,
    })
    const r = run([early, late])
    // early 在第 0 帧跑完，late 第 1 帧才进入队列
    expect(r.frames[0].slices.map((s) => s.taskId)).toEqual(['early'])
    expect(r.frames[1].arrivals).toEqual(['late'])
    expect(r.frames[1].slices[0].taskId).toBe('late')
  })
})

describe('抢占（协作式切片）', () => {
  it('可取消长任务在每个帧边界让出，形成多个切片且不掉帧（恰好达标）', () => {
    const r = run([task({ id: 'p', label: '可让出', durationMs: 34 })])
    const sliceTasks = r.frames.flatMap((f) => f.slices)
    expect(sliceTasks.filter((s) => s.preempted)).toHaveLength(2)
    expect(sliceTasks[sliceTasks.length - 1].completed).toBe(true)
    expect(r.outcomes[0].preemptions).toBe(2)
    // 每段都恰好在 vsync 线或之前结束
    for (const f of r.frames) {
      expect(f.threadEndTick).toBeLessThanOrEqual(f.windowEndTick)
    }
    expect(r.stats.completionTimeMs).toBe(34)
  })

  it('被抢占任务在下一帧仍优先于更低优先级任务', () => {
    const resumable = task({ id: 'r', label: '切片任务', durationMs: 20, priority: 'normal' })
    const low = task({ id: 'low', label: '低', durationMs: 2, priority: 'low' })
    const r = run([resumable, low])
    // 第 1 帧应继续 r，而不是先跑 low
    expect(r.frames[1].slices[0].taskId).toBe('r')
    expect(r.frames[0].deferred).toContain('low')
  })
})

describe('取消', () => {
  it('任务开始前取消：savedMs 为全部耗时，wastedMs 为 0，不占用主线程', () => {
    const t = task({ id: 'p', label: '预加载', durationMs: 30, priority: 'low', arrivalFrame: 0 })
    const r = run([t], [{ taskId: 'p', atFrame: 0 }])
    const o = r.outcomes[0]
    expect(o.status).toBe('canceled')
    expect(o.savedMs).toBe(30)
    expect(o.wastedMs).toBe(0)
    expect(r.frames[0].cancelResults[0]).toEqual({ taskId: 'p', kind: 'cancelled' })
    // 没有为它执行任何主线程时间
    expect(r.stats.totalMainThreadMs).toBe(0)
  })

  it('部分执行后取消：wastedMs 为已执行时间，savedMs 为剩余时间', () => {
    const t = task({ id: 'p', label: '预加载', durationMs: 40, priority: 'low' })
    // 让它前面排一个关键任务，使 p 到第 1 帧才开始
    const blocker = task({ id: 'b', label: '解码', durationMs: 16, priority: 'critical' })
    const cancels: CancelSpec[] = [{ taskId: 'p', atFrame: 2 }]
    const r = run([blocker, t], cancels)
    const o = r.outcomes.find((x) => x.id === 'p')!
    expect(o.status).toBe('canceled')
    expect(o.partiallyCanceled).toBe(true)
    // 第 1 帧从 16ms 开始跑到 32ms（被抢占），第 2 帧 vsync 取消 → 白跑 16ms
    expect(o.wastedMs).toBe(16)
    expect(o.savedMs).toBe(24)
    expect(r.frames[2].cancelResults[0].kind).toBe('cancelled-partial')
  })

  it('不可取消任务的取消请求被拒绝，任务照常完成', () => {
    const t = task({ id: 'd', label: '解码', durationMs: 5, cancelable: false })
    const r = run([t], [{ taskId: 'd', atFrame: 0 }])
    expect(r.frames[0].cancelResults[0].kind).toBe('rejected-uncancelable')
    expect(r.outcomes[0].status).toBe('done')
  })

  it('任务完成后的取消请求被拒绝', () => {
    const t = task({ id: 'a', label: 'a', durationMs: 1 })
    const r = run([t], [{ taskId: 'a', atFrame: 2 }])
    const frame2 = r.frames.find((f) => f.index === 2)!
    expect(frame2.cancelResults[0].kind).toBe('rejected-complete')
  })

  it('取消尚未进入队列或不存在的任务被拒绝', () => {
    const t = task({ id: 'a', label: 'a', durationMs: 1, arrivalFrame: 2 })
    const r1 = run([t], [{ taskId: 'a', atFrame: 0 }])
    expect(r1.frames[0].cancelResults[0].kind).toBe('rejected-not-found')
    const r2 = run([t], [{ taskId: 'ghost', atFrame: 0 }])
    expect(r2.frames[0].cancelResults[0].kind).toBe('rejected-not-found')
  })
})

describe('长任务与掉帧', () => {
  it('不可取消任务越过 vsync 线：标记长任务，本帧与下一帧都掉帧', () => {
    const t = task({ id: 'd', label: '解码', durationMs: 22, cancelable: false })
    const r = run([t])
    expect(r.frames[0].slices[0]).toMatchObject({ longTask: true, taskId: 'd' })
    expect(r.frames[0].dropped).toBe(true)
    expect(r.frames[0].dropReasons).toContainEqual({ type: 'long-task', taskId: 'd' })
    // 220 - 160 = 60 tick 溢出到第 1 帧前 6ms：第 1 帧部分被占、仍然掉帧
    expect(r.frames[1].blocked).toBe(false)
    expect(r.frames[1].dropped).toBe(true)
    expect(r.frames[1].dropReasons).toEqual([{ type: 'overflow-from', frame: 0 }])
    expect(r.stats.droppedFrames).toEqual([0, 1])
    expect(r.outcomes[0].longTask).toBe(true)
    expect(r.stats.longTaskCount).toBe(1)
  })

  it('溢出超过一整帧时，中间帧被标记为整帧阻塞', () => {
    const t = task({ id: 'd', label: '巨型解码', durationMs: 40, cancelable: false })
    const r = run([t])
    // 0..400 原子执行：帧 0 长任务，帧 1 [160,320) 完全被占，帧 2 前 8ms 受波及
    expect(r.frames[0].slices[0].longTask).toBe(true)
    expect(r.frames[1].blocked).toBe(true)
    expect(r.frames[1].dropReasons).toEqual([{ type: 'overflow-from', frame: 0 }])
    expect(r.frames[2].blocked).toBe(false)
    expect(r.frames[2].dropped).toBe(true)
    expect(r.stats.droppedFrames).toEqual([0, 1, 2])
  })

  it('把同一个任务改成可取消后，掉帧消失（长任务被切片替代）', () => {
    const atomic = run([task({ id: 'd', label: '解码', durationMs: 22, cancelable: false })])
    const sliced = run([task({ id: 'd', label: '解码', durationMs: 22, cancelable: true })])
    expect(atomic.stats.droppedCount).toBeGreaterThan(0)
    expect(sliced.stats.droppedCount).toBe(0)
    expect(sliced.stats.longTaskCount).toBe(0)
  })

  it('长任务期间到达的任务只能在溢出结束后的帧窗口里执行', () => {
    const d = task({ id: 'd', label: '解码', durationMs: 22, cancelable: false, priority: 'critical' })
    const l = task({ id: 'l', label: '布局', durationMs: 4, priority: 'high' })
    const r = run([d, l])
    // 第 1 帧窗口从 16ms 起，但主线程 22ms 才空闲；l 在 22ms 处执行
    const layoutSlice = r.frames[1].slices.find((s) => s.taskId === 'l')!
    expect(layoutSlice.startTick).toBe(220)
    expect(layoutSlice.endTick).toBe(260)
  })
})

describe('确定性重放', () => {
  const input: SimulationInput = {
    tasks: [
      task({ id: 'decode', label: '解码', durationMs: 22, priority: 'critical', cancelable: false, kind: 'decode' }),
      task({ id: 'layout', label: '布局', durationMs: 9, priority: 'high', kind: 'layout' }),
      task({ id: 'log', label: '日志', durationMs: 4, priority: 'normal', kind: 'log' }),
      task({ id: 'preload', label: '预加载', durationMs: 30, priority: 'low', kind: 'preload' }),
    ],
    cancels: [{ taskId: 'preload', atFrame: 2 }],
  }

  it('相同输入两次模拟结果完全一致', () => {
    expect(simulate(input)).toEqual(simulate(input))
  })

  it('打乱输入数组顺序不影响结果（排序只依赖优先级/到达帧/id）', () => {
    const shuffled: SimulationInput = {
      ...input,
      tasks: [...input.tasks].reverse(),
      cancels: [...(input.cancels ?? [])],
    }
    expect(simulate(shuffled)).toEqual(simulate(input))
  })
})

describe('内置场景：切换直播画面', () => {
  it('默认参数存在长任务与掉帧', () => {
    const r = simulate(SWITCH_LIVE_SCENARIO)
    expect(r.stats.longTaskCount).toBeGreaterThanOrEqual(1)
    expect(r.stats.droppedCount).toBeGreaterThanOrEqual(1)
    const decode = r.outcomes.find((o) => o.id === 'decode')!
    expect(decode.longTask).toBe(true)
  })

  it('在第 1 帧取消预加载后，完成时间显著缩短，取消节省被统计', () => {
    const before = simulate(SWITCH_LIVE_SCENARIO)
    const after = simulate({
      ...SWITCH_LIVE_SCENARIO,
      cancels: [{ taskId: 'preload', atFrame: 1 }],
    })
    expect(after.stats.completionTimeMs).toBeLessThan(before.stats.completionTimeMs)
    const preload = after.outcomes.find((o) => o.id === 'preload')!
    expect(preload.status).toBe('canceled')
    expect(preload.savedMs).toBeGreaterThan(0)
    expect(after.stats.savedMsByCancel).toBe(30)
  })

  it('把解码改为可切片后掉帧数归零（用户调参驱动重算）', () => {
    const before = simulate(SWITCH_LIVE_SCENARIO)
    const after = simulate({
      ...SWITCH_LIVE_SCENARIO,
      tasks: SWITCH_LIVE_SCENARIO.tasks.map((t) =>
        t.id === 'decode' ? { ...t, cancelable: true, durationMs: 12 } : t,
      ),
    })
    expect(before.stats.droppedCount).toBeGreaterThan(after.stats.droppedCount)
    expect(after.stats.droppedCount).toBe(0)
  })
})
