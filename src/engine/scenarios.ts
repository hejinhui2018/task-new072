/**
 * 内置巡检场景：切换直播画面。
 *
 * 一次画面切换在主线程上触发一串工作：
 *  1. 解码新分片（关键，不可中断 —— 模拟同步解码回调）
 *  2. 布局重排（高，可协作让出）
 *  3. 写一条操作日志（普通，可让出）
 *  4. 预加载下一个机位（低，可取消 —— 用户可能立刻再切走）
 *
 * 默认参数下解码是长任务，直接吃掉第 0 帧并波及第 1 帧；
 * 低优先级预加载被一推再推。用户可以：
 *  - 调整任务优先级（观察排序变化与掉帧增减）
 *  - 在第 1 帧取消预加载（观察“部分执行后取消 / 未开始取消”的差别与节省时间）
 *  - 调整各任务预计耗时与可取消性
 */
import { CancelSpec, TaskSpec } from './types'

export interface Scenario {
  id: string
  name: string
  description: string
  tasks: TaskSpec[]
  cancels: CancelSpec[]
}

export const SWITCH_LIVE_SCENARIO: Scenario = {
  id: 'switch-live',
  name: '切换直播画面',
  description:
    '用户在导播台点击切换机位：同步解码新分片、重排布局、写操作日志，' +
    '并低优先级预加载下一个候选机位。默认参数会产生长任务与掉帧，' +
    '试着调整优先级或取消预加载，观察掉帧数与完成时间如何变化。',
  tasks: [
    {
      id: 'decode',
      label: '解码新画面分片',
      kind: 'decode',
      priority: 'critical',
      durationMs: 22,
      arrivalFrame: 0,
      cancelable: false,
    },
    {
      id: 'layout',
      label: '布局重排',
      kind: 'layout',
      priority: 'high',
      durationMs: 9,
      arrivalFrame: 0,
      cancelable: true,
    },
    {
      id: 'log',
      label: '写切换操作日志',
      kind: 'log',
      priority: 'normal',
      durationMs: 4,
      arrivalFrame: 0,
      cancelable: true,
    },
    {
      id: 'preload',
      label: '预加载下一机位',
      kind: 'preload',
      priority: 'low',
      durationMs: 30,
      arrivalFrame: 0,
      cancelable: true,
    },
  ],
  cancels: [],
}

export const SCENARIOS: Scenario[] = [SWITCH_LIVE_SCENARIO]
