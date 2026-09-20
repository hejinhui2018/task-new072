// ─────────────────────────────────────────────────────────────────────────────
// Bench 会话：在指定舞台节点里真实挂载一个自定义元素 + “按 v1 契约编写”的业务宿主
// 业务宿主固定做四件事（模拟存量业务页面，不随后续升级而改变）：
//   1. 投影 <span slot="header"> 与默认 slot 正文
//   2. 设置旧属性 title
//   3. 在宿主上监听旧事件 card-submit
//   4. 用 ::part(submit-button) 写旧样式（绿色），同时也写了新名样式（蓝色）做对照
// 会话是有状态的交互流载体：六步验收按顺序在同一个会话上执行动作
// ─────────────────────────────────────────────────────────────────────────────

import type { FaultSet, LogEntry } from '../contract/types'
import { getContract } from '../contract/versions'
import { getRegistered } from '../element/registry'
import type { BenchRuntime } from '../element/createCard'
import { getInternal, prebindRuntime } from '../element/createCard'

export interface HostEventObservation {
  type: string
  phase: number
  path: string
  detail: unknown
  at: number
}

export interface BenchContext {
  stage: HTMLElement
  container: HTMLDivElement
  host: HTMLElement // 业务宿主（普通容器元素，代表业务页面）
  card: HTMLElement // 自定义元素
  runtime: BenchRuntime
  hostEvents: HostEventObservation[]
  logs: LogEntry[]
  /** 升级模式下：挂载时元素尚未注册（未升级），调用后完成 define+升级 */
  upgrade?: () => Promise<void>
  teardown: () => void
}

let instanceSeq = 0

export interface MountOptions {
  version: string
  faults: FaultSet
  stage: HTMLElement
  /** 升级边界测试：先以未注册标签挂载（未升级形态），之后再 define */
  unregisteredTag?: string
  presetTitle?: string
}

export function mountBench(opts: MountOptions): BenchContext {
  const contract = getContract(opts.version)
  const normalTag = getRegistered(opts.version).tag
  const tag = opts.unregisteredTag ?? normalTag
  const upgradeMode = !!opts.unregisteredTag

  const logs: LogEntry[] = []
  const hostEvents: HostEventObservation[] = []
  const pushLog: BenchRuntime['log'] = (phase, message, level = 'info') => {
    logs.push({ t: performance.now(), phase, message, level })
  }

  const container = document.createElement('div')
  container.className = 'bench-container'

  const host = document.createElement('div')
  host.className = 'business-host'

  const card = document.createElement(tag) as HTMLElement

  const runtime: BenchRuntime = {
    instanceId: `inst-${++instanceSeq}-${opts.version}`,
    version: opts.version,
    faults: new Set(opts.faults),
    dispatches: [],
    log: pushLog,
  }

  // 未升级元素没有实例方法：用节点级 WeakMap 预置 runtime，升级瞬间的 connectedCallback 读取
  if (upgradeMode) prebindRuntime(card, runtime)
  else (card as unknown as { __bindRuntime: (r: BenchRuntime) => void }).__bindRuntime(runtime)

  // ── 业务宿主投影（旧契约 v1）──
  const header = document.createElement('span')
  header.slot = 'header'
  header.textContent = opts.presetTitle ?? '旧页面标题（slot=header）'
  const bodyText = document.createElement('p')
  bodyText.textContent = '旧页面投影的正文内容（默认 slot）'
  card.append(header, bodyText)

  // ── 业务宿主写旧属性 title ──
  card.setAttribute('title', opts.presetTitle ?? '在线 title=我的卡片')

  // ── 业务宿主监听旧事件 card-submit（冒泡，挂在宿主上）──
  const hostListener = (e: Event) => {
    hostEvents.push({
      type: e.type,
      phase: e.eventPhase,
      path: e.composedPath().map(describeEventPathNode).join(' → '),
      detail: (e as CustomEvent).detail ?? null,
      at: performance.now(),
    })
    pushLog('host', `业务宿主收到事件 ${e.type}（冒泡阶段，eventPhase=${e.eventPhase}）`, 'ok')
  }
  host.addEventListener('card-submit', hostListener)

  // ── 业务宿主的旧 ::part 样式（新名规则作对照）──
  const hostStyle = document.createElement('style')
  hostStyle.textContent = `
    .business-host ${tag}::part(submit-button){ background:#16a34a !important; }
    .business-host ${tag}::part(submit){ background:#2563eb !important; }
  `
  host.append(hostStyle)
  host.append(card)
  container.append(host)
  opts.stage.append(container)

  pushLog(
    'engine',
    `${upgradeMode ? `未升级元素 <${tag}> 已入 DOM（HTMLUnknownElement 形态）` : `挂载 <${tag}>（${contract.label}）`}` +
      `；faults=[${opts.faults.join(', ') || '无'}]`,
    'info',
  )

  let ctx: BenchContext
  const teardown = () => {
    host.removeEventListener('card-submit', hostListener)
    container.remove()
    pushLog('engine', '会话卸载（teardown）', 'warn')
  }

  ctx = {
    stage: opts.stage,
    container,
    host,
    card,
    runtime,
    hostEvents,
    logs,
    teardown,
  }

  return ctx
}

export function probeCard(card: HTMLElement) {
  return (card as unknown as { __probe: () => import('../element/createCard').ElementProbe }).__probe()
}

export function clickInternalSubmit(card: HTMLElement) {
  const internal = getInternal(card)
  if (!internal) throw new Error('内部引用缺失（元素可能尚未升级）')
  internal.btn.click()
}

function describeEventPathNode(n: EventTarget | null): string {
  if (!n) return '∅'
  if (n instanceof ShadowRoot) return `#shadow-root(${n.mode})`
  if (n instanceof Document) return '#document'
  if (n instanceof Window) return '#window'
  if (n instanceof Element) {
    const t = n.tagName.toLowerCase()
    return t.includes('-') ? `<${t}>` : t
  }
  return n.constructor?.name ?? '?'
}
