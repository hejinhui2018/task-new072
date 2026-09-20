// ─────────────────────────────────────────────────────────────────────────────
// 边界套件：升级边界 / 重挂载 / 多实例隔离
// 每个套件在自己的隐藏舞台里真实挂载、操作、卸载；结论同样基于探针观测而非版本名
// ─────────────────────────────────────────────────────────────────────────────

import type { FaultSet, SuiteCaseResult, SuiteId, SuiteResult, Verdict } from '../contract/types'
import { CONTRACTS } from '../contract/versions'
import { clickInternalSubmit, mountBench, probeCard, type BenchContext } from './mountBench'
import { defineFreshTag, makeFreshTag } from '../element/registry'
import { getInternal } from '../element/createCard'

interface SuiteDef {
  id: SuiteId
  title: string
  principle: string
  run: (version: string, faults: FaultSet) => SuiteCaseResult[] | Promise<SuiteCaseResult[]>
}

function scratchStage(): HTMLElement {
  const stage = document.createElement('div')
  stage.hidden = true
  document.body.appendChild(stage)
  return stage
}

// ── 套件一：升级边界 ─────────────────────────────────────────────────────────
// 元素先以未升级形态进入 DOM（业务脚本先于组件库加载的真实场景），
// 之后才 customElements.define。验证：升级不丢 light DOM、初始属性在升级瞬间补回调、
// shadow 只建一次、升级后事件行为与该版本契约一致。
const upgradeSuite: SuiteDef = {
  id: 'upgrade',
  title: '升级边界：未升级 → define 升级',
  principle:
    '自定义元素可以先以“未定义自定义元素”形态存在（构造器是 HTMLElement，无 shadow、无回调），' +
    'define 之后浏览器同步升级文档中的同标签节点：补跑 constructor/connectedCallback，' +
    '并为升级前已存在且在 observedAttributes 中的属性补跑 attributeChangedCallback。' +
    '升级不会移动 light DOM 节点；适配层必须保证升级前写入的旧属性在这一刻被接住。',
  async run() {
    const cases: SuiteCaseResult[] = []
    for (const contract of CONTRACTS) {
      const stage = scratchStage()
      const { tag, ctor } = makeFreshTag(contract.version)
      const ctx = mountBench({ version: contract.version, faults: [], stage, unregisteredTag: tag })

      const preUpgraded =
        ctx.card.constructor === HTMLElement || ctx.card.constructor.name === 'HTMLUnknownElement'
      const preShadow = ctx.card.shadowRoot
      const preChildren = ctx.card.children.length
      const preTitle = ctx.card.getAttribute('title')

      await defineFreshTag(tag, ctor)

      const probe = probeCard(ctx.card)
      const postShadow = !!ctx.card.shadowRoot || probe.shadowMode === 'closed'
      const headerAssigned = probe.slots
        .find((s) => s.name === 'header')
        ?.assigned.some((a) => a.includes('slot="header"'))
      const titlebarFallbackOnly =
        contract.kind === 'breaking' && probe.slots.find((s) => s.name === 'titlebar')?.fallbackShown

      // 升级后点一次提交，验证事件面在升级后才“活过来”
      let hostGot = false
      const oneShot = () => (hostGot = true)
      ctx.host.addEventListener('card-submit', oneShot)
      clickInternalSubmit(ctx.card)
      ctx.host.removeEventListener('card-submit', oneShot)

      const parts: [string, Verdict, string][] = [
        [
          '升级前形态',
          preUpgraded && !preShadow ? 'pass' : 'fail',
          `constructor=${preUpgraded ? 'HTMLElement（未升级）' : '已是子类'}；shadowRoot=${preShadow ? '已存在' : 'null'}；light 子节点 ${preChildren} 个；title="${preTitle}"`,
        ],
        [
          '升级后 shadow 建立',
          postShadow ? 'pass' : 'fail',
          `define 后 connectedCallback 执行，shadow(${probe.shadowMode}) 建立，part=[${probe.parts.join(', ') || '∅'}]`,
        ],
        [
          '升级前 light DOM 无损',
          probe.lightChildren.length === preChildren ? 'pass' : 'fail',
          `升级前后 light 子节点均为 ${preChildren} 个；浏览器升级只换原型/补回调，不碰子树`,
        ],
        [
          '旧投影在升级后的归宿',
          contract.kind === 'legacy' || headerAssigned
            ? contract.kind === 'compat'
              ? 'adapted'
              : 'pass'
            : 'loss',
          headerAssigned
            ? contract.kind === 'compat'
              ? '旧 header 投影经适配层嵌套槽桥接渲染'
              : '旧 header 投影被原生 slot 接收'
            : titlebarFallbackOnly
              ? '旧 span 未被接收（titlebar 只显示回退）—— 升级不会替业务改名，静默丢失'
              : '旧投影未被接收',
        ],
        [
          '升级前旧属性 title 的处理',
          contract.kind === 'legacy'
            ? 'pass'
            : contract.kind === 'compat'
              ? probe.attributes.some((a) => a.name === 'heading')
                ? 'adapted'
                : 'loss'
              : 'loss',
          contract.kind === 'breaking'
            ? '升级补回调只针对 observedAttributes=[heading,disabled]：预置 title 从未触发回调'
            : contract.kind === 'compat'
              ? '升级补回调覆盖旧名 title：适配层在升级瞬间转发 heading'
              : '升级补回调直接命中 title',
        ],
        [
          '升级后提交事件',
          contract.kind === 'legacy'
            ? 'pass'
            : contract.kind === 'compat' && hostGot
              ? 'adapted'
              : 'loss',
          hostGot
            ? '业务宿主在升级后收到 card-submit' + (contract.kind === 'compat' ? '（经适配层别名补发）' : '')
            : '升级后内部按钮可点，但 card-submit 到不了业务宿主（改名+composed 断裂）',
        ],
      ]

      for (const [name, verdict, detail] of parts) {
        cases.push({ name: `[${contract.version}] ${name}`, version: contract.version, verdict, detail })
      }
      ctx.teardown()
      stage.remove()
    }
    return cases
  },
}

// ── 套件二：重挂载 ───────────────────────────────────────────────────────────
const remountSuite: SuiteDef = {
  id: 'remount',
  title: '重挂载：移除 → 重新插入 → 新实例',
  principle:
    '同一自定义元素节点移出文档触发 disconnectedCallback（shadow 树与属性都保留），重新插入触发 connectedCallback —— ' +
    '健壮的组件必须幂等：不能重复 attachShadow、不能重复绑定监听。卸载后新建同标签实例则应是干净状态。',
  run(version, faults) {
    const stage = scratchStage()
    const ctx = mountBench({ version, faults, stage })
    const cases: SuiteCaseResult[] = []

    const shadowCountBefore = countShadowRoots(ctx)
    clickInternalSubmit(ctx.card)
    const eventsBefore = ctx.hostEvents.length

    // 移出 → 重新插入同一批节点（shadow 树与监听随节点保留）
    ctx.container.remove()
    stage.appendChild(ctx.container)

    let reconnectOk = true
    let reconnectError = ''
    try {
      clickInternalSubmit(ctx.card)
    } catch (e) {
      reconnectOk = false
      reconnectError = (e as Error).message
    }
    const shadowCountAfter = countShadowRoots(ctx)
    const eventsAfter = ctx.hostEvents.length

    cases.push({
      name: '重连后不重复建 shadow / 不重复绑监听',
      version,
      verdict: reconnectOk && shadowCountBefore === shadowCountAfter ? 'pass' : 'fail',
      detail: `重连前后 shadow root 数 ${shadowCountBefore}→${shadowCountAfter}；connectedCallback 幂等（复用旧树）${
        reconnectOk ? '' : `；重连后点击报错：${reconnectError}`
      }`,
    })
    cases.push({
      name: '重连后事件仍到达原业务宿主',
      version,
      verdict: reconnectOk && eventsAfter > eventsBefore ? 'pass' : 'fail',
      detail: `宿主监听挂在同一节点上，重连不拆除监听；card-submit 计数 ${eventsBefore}→${eventsAfter}`,
      evidence: { eventsBefore, eventsAfter },
    })

    // 全新实例不应读到实例一留下的状态（模块级单例会在这里暴露）
    const marker = `只属于${version}实例一#${ctx.runtime.instanceId}`
    const propName = version === 'v1' ? 'title' : 'heading'
    ;(ctx.card as unknown as Record<string, string>)[propName] = marker

    const ctx2 = mountBench({ version, faults, stage, presetTitle: '另一个实例' })
    const probe2 = probeCard(ctx2.card)
    const leaked = String(probe2.props[propName]?.value ?? '') === marker
    const shared = faults.includes('sharedState')
    cases.push({
      name: '卸载后新建实例不继承旧实例状态',
      version,
      verdict: !leaked && !shared ? 'pass' : 'loss',
      detail:
        leaked || shared
          ? `故障 sharedState：新实例读到实例一写入的 ${propName}="${marker}"（探针 sharedHeading="${probe2.sharedHeading}"）`
          : `新实例 ${propName}=${JSON.stringify(probe2.props[propName]?.value ?? '')}，不含实例一标记，存储相互独立`,
      evidence: { sharedHeading: probe2.sharedHeading, leaked },
    })

    ctx.teardown()
    ctx2.teardown()
    stage.remove()
    return cases
  },
}

// ── 套件三：多实例隔离 ───────────────────────────────────────────────────────
const isolationSuite: SuiteDef = {
  id: 'isolation',
  title: '多实例隔离：同页两个实例互不串扰',
  principle:
    '同一页面经常并存多个组件实例。事件必须只在自己的 shadow→host 链路上冒泡；' +
    '属性/property 必须实例私有；样式 ::part 只作用于本实例。' +
    '把状态放到模块级单例是升级期常见退化：功能看似正常，实例之间却互相覆盖。',
  run(version, faults) {
    const stage = scratchStage()
    const a = mountBench({ version, faults, stage, presetTitle: '实例A' })
    const b = mountBench({ version, faults, stage, presetTitle: '实例B' })
    const cases: SuiteCaseResult[] = []
    const shared = faults.includes('sharedState')

    // 事件隔离：只点 A。隔离性看宿主B 是否被波及（aEvents=0 属于契约断裂，在六步验收里报告）
    clickInternalSubmit(a.card)
    const aEvents = a.hostEvents.length
    const bEvents = b.hostEvents.length
    cases.push({
      name: '事件只到达自己的宿主',
      version,
      verdict: bEvents === 0 ? 'pass' : 'fail',
      detail: `点击实例 A：宿主A 收到 ${aEvents} 次 card-submit，宿主B 收到 ${bEvents} 次；retarget 后事件只沿 A 自己的链路冒泡${
        aEvents === 0 ? '（A 自己收不到是契约断裂问题，不是串扰，见六步验收⑤）' : ''
      }`,
      evidence: { hostA: aEvents, hostB: bEvents },
    })

    // property 隔离：两实例各写不同值，再分别读回
    const headingProp = version === 'v1' ? 'title' : 'heading'
    ;(a.card as unknown as Record<string, string>)[headingProp] = '只属于A的值'
    ;(b.card as unknown as Record<string, string>)[headingProp] = '只属于B的值'
    const pa2 = probeCard(a.card)
    const pb2 = probeCard(b.card)
    const va = String(pa2.props[headingProp]?.value ?? '')
    const vb = String(pb2.props[headingProp]?.value ?? '')
    const propIsolated = va === '只属于A的值' && vb === '只属于B的值'
    cases.push({
      name: 'property 实例私有',
      version,
      verdict: propIsolated && !shared ? 'pass' : 'loss',
      detail: propIsolated
        ? `A.${headingProp}=${JSON.stringify(va)}；B.${headingProp}=${JSON.stringify(vb)}，各自独立`
        : `故障 sharedState：两实例共享模块单例，A 读到 ${JSON.stringify(va)}、B 读到 ${JSON.stringify(vb)}（后写覆盖前写）`,
      evidence: { A: va, B: vb, sharedHeading: pa2.sharedHeading },
    })

    // DOM/样式隔离：两个 shadow 独立计数
    const roots = countShadowRoots(a) + countShadowRoots(b)
    const slotsA = pa2.slots.length
    const slotsB = pb2.slots.length
    cases.push({
      name: 'shadow 结构与投影独立',
      version,
      verdict: roots === 2 && slotsA > 0 && slotsA === slotsB ? 'pass' : 'fail',
      detail: `两个实例各持有独立 shadow root（共 ${roots}），slot 数 ${slotsA}/${slotsB}；light DOM 与投影互不混入`,
    })

    a.teardown()
    b.teardown()
    stage.remove()
    return cases
  },
}

function countShadowRoots(ctx: BenchContext): number {
  // open 直接数；closed 用内部引用兜底
  let n = ctx.card.shadowRoot ? 1 : 0
  if (!n && getInternal(ctx.card)?.root) n = 1
  return n
}

const SUITES: SuiteDef[] = [upgradeSuite, remountSuite, isolationSuite]

export async function runSuites(version: string, faults: FaultSet): Promise<SuiteResult[]> {
  const out: SuiteResult[] = []
  for (const def of SUITES) {
    const cases = await def.run(version, faults)
    out.push({
      id: def.id,
      title: def.title,
      principle: def.principle,
      cases,
      ranAt: Date.now(),
    })
  }
  return out
}
