/**
 * 帧调度模拟引擎的类型定义。
 * 时间单位：内部用 tick（1 tick = TICK_MS，默认 0.1ms）的整数运算，避免浮点误差；
 * 对外输入/输出统一使用 ms。
 */

export type Priority = 'critical' | 'high' | 'normal' | 'low'

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: '关键',
  high: '高',
  normal: '普通',
  low: '低',
}

export type TaskKind = 'decode' | 'layout' | 'log' | 'preload' | 'custom'

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  decode: '解码',
  layout: '布局',
  log: '日志',
  preload: '预加载',
  custom: '自定义',
}

/** 每帧 vsync 预算（ms），60fps 约为 16.67ms，本工具按需求取 16ms */
export const FRAME_BUDGET_MS = 16
/** 内部时间精度：0.1ms */
export const TICK_MS = 0.1

/** 一个主线程任务的静态描述 */
export interface TaskSpec {
  id: string
  label: string
  kind: TaskKind
  priority: Priority
  /** 预计耗时（ms），0.1ms 步进 */
  durationMs: number
  /** 任务在第几帧的 vsync 时刻进入队列（0 起算） */
  arrivalFrame: number
  /**
   * 是否可取消 / 可协作让出。
   * - true：超过单帧预算时在帧边界被切片抢占（preempt），且可被取消事件取消
   * - false：一旦开始便原子执行完，超过预算即长任务；取消事件一律被拒绝
   */
  cancelable: boolean
}

/** 在指定帧的 vsync 时刻对某任务发出取消请求 */
export interface CancelSpec {
  taskId: string
  atFrame: number
}

export interface SimulationInput {
  tasks: TaskSpec[]
  cancels?: CancelSpec[]
  frameBudgetMs?: number
}

export type CancelResultKind =
  | 'cancelled'
  | 'cancelled-partial'
  | 'rejected-uncancelable'
  | 'rejected-complete'
  | 'rejected-not-found'

export const CANCEL_RESULT_LABEL: Record<CancelResultKind, string> = {
  cancelled: '已取消（未开始）',
  'cancelled-partial': '已取消（部分执行后放弃）',
  'rejected-uncancelable': '拒绝：任务不可取消',
  'rejected-complete': '拒绝：任务已结束',
  'rejected-not-found': '拒绝：任务不在队列中',
}

/** 任务在主线程上的一段连续占用 */
export interface SliceRecord {
  taskId: string
  startTick: number
  endTick: number
  /** 整段原子执行并越过帧预算 */
  longTask: boolean
  /** 可取消任务在帧边界被抢占，后续还有剩余切片 */
  preempted: boolean
  /** 该切片是否让任务进入终态 */
  completed: boolean
}

export interface CancelResultRecord {
  taskId: string
  kind: CancelResultKind
}

export type DropReason =
  | { type: 'long-task'; taskId: string }
  | { type: 'overflow-from'; frame: number }

/** 一帧（一个 vsync 窗口）内发生的全部事情 */
export interface FrameRecord {
  index: number
  windowStartTick: number
  windowEndTick: number
  /** 帧首时刻主线程时钟（可能早于窗口起点，即上一帧长任务的溢出时间） */
  threadStartTick: number
  /** 帧末时刻主线程时钟 */
  threadEndTick: number
  arrivals: string[]
  cancelResults: CancelResultRecord[]
  slices: SliceRecord[]
  /** 本帧因剩余预算不足被推迟到下一帧的任务 */
  deferred: string[]
  /** 整帧被上一个长任务占用，没有任何调度机会 */
  blocked: boolean
  /** 主线程占用越过本帧渲染截止线（windowEndTick） */
  dropped: boolean
  dropReasons: DropReason[]
}

export type TaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'canceled'

export interface TaskOutcome {
  id: string
  label: string
  status: TaskStatus
  startedTick: number | null
  endedTick: number | null
  /** 实际在主线程上消耗的时间 */
  executedMs: number
  /** 被取消前已经白跑的时间（仅 cancelled-partial） */
  wastedMs: number
  /** 因取消而避免占用主线程的时间 */
  savedMs: number
  /** 是否产生过长任务 */
  longTask: boolean
  /** 被帧边界抢占的次数 */
  preemptions: number
  /** 被推迟到下一帧的次数 */
  deferredTurns: number
  partiallyCanceled: boolean
}

export interface SimulationStats {
  frameCount: number
  droppedFrames: number[]
  droppedCount: number
  longTaskCount: number
  deferredCount: number
  preemptedSliceCount: number
  /** 所有任务到达终态的时间（ms） */
  completionTimeMs: number
  /** 完成时刻落在第几帧（1 起算，用于“用了几帧”的展示） */
  completionFrame: number
  totalMainThreadMs: number
  savedMsByCancel: number
  wastedMsByCancel: number
}

export interface SimulationResult {
  budgetMs: number
  budgetTick: number
  frames: FrameRecord[]
  outcomes: TaskOutcome[]
  stats: SimulationStats
}
