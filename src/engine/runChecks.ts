// ─────────────────────────────────────────────────────────────────────────────
// 六步验收引擎：mount → slots → attributes → properties → events → parts
//
// 每个检查分两段：
//   act(ctx)   —— 执行业务宿主侧的真实交互（投影/属性/property/点击/样式）
//   check(ctx) —— 从边界两侧观测，产出断言与原理说明
// 单步执行 = 新建会话并重放前置动作到该步；自动执行 = 连续跑满六步。
// verdict 不按版本名硬编码，而由「契约 renamedFrom + 真实探针观测」推导，
// 因此故障注入能真实翻转结论。
// ─────────────────────────────────────────────────────────────────────────────

import type { CheckAssertion, CheckId, FaultSet, StepResult, Verdict } from '../contract/types'
import { getContract } from '../contract/versions'
import { getInternal } from '../element/createCard'
import { clickInternalSubmit, mountBench, probeCard, type BenchContext } from './mountBench'

const ORDER: Record<Verdict, number> = { pass: 0, adapted: 1, loss: 2, fail: 3 }
const worst = (a: Verdict, b: Verdict): Verdict => (ORDER[a] >= ORDER[b] ? a : b)
const aggregate = (list: CheckAssertion[]): Verdict =>
  list.reduce<Verdict>((acc, a) => worst(acc, a.verdict), 'pass')

export interface CheckSession {
  ctx: BenchContext
  results: Partial<Record<CheckId, StepResult>>
  teardown: () => void
}

interface CheckDef {
  id: CheckId
  title: string
  principle: string
  expected: string
  act?: (ctx: BenchContext) => void
  check: (ctx: BenchContext) => {
    assertions: CheckAssertion[]
    actual: string
    evidence: Record<string, unknown>
    adaptationTrace?: string[]
  }
}

// ── ① 挂载注册 ───────────────────────────────────────────────────────────────
const mountCheck: CheckDef = {
  id: 'mount',
  title: '① 挂载与注册',
  principle:
    'customElements.define 之后浏览器把标签升级为自定义元素：constructor/connectedCallback 执行，attachShadow 建立 shadow 树。' +
    'open 模式下 el.shadowRoot 暴露给外部；closed 模式返回 null，外部只能走标准对外面（属性 / 事件 / ::part）。',
  expected: '元素 isConnected；shadowRoot(open) 可探查；shadow 内存在提交按钮。',
  check(ctx) {
    const probe = probeCard(ctx.card)
    const closedFault = ctx.runtime.faults.has('closedShadow')
    const assertions: CheckAssertion[] = [
      {
        name: '自定义元素已升级并连接',
        expected: ctx.card.tagName.toLowerCase(),
        actual: probe.connected ? 'connectedCallback 已执行，元素在文档中' : '未连接/未升级',
        verdict: probe.connected ? 'pass' : 'fail',
      },
      {
        name: 'shadowRoot 对外可见性',
        expected: 'open：el.shadowRoot 可探查',
        actual: probe.externalShadowRoot
          ? `open，shadow 下 ${probe.externalShadowRoot.childCount} 个子节点`
          : `el.shadowRoot === null（mode=${probe.shadowMode}）`,
        verdict: probe.externalShadowRoot ? 'pass' : closedFault ? 'adapted' : 'fail',
      },
      {
        name: '内部提交按钮',
        expected: 'shadow 内存在 <button>',
        actual: getInternal(ctx.card)?.btn ? '按钮存在' : '按钮缺失',
        verdict: getInternal(ctx.card)?.btn ? 'pass' : 'fail',
      },
    ]
    return {
      assertions,
      actual: `connected=${probe.connected}，shadow=${probe.shadowMode}，part=[${probe.parts.join(', ') || '∅'}]`,
      evidence: { probe },
      adaptationTrace: closedFault
        ? ['closed 是合法封装：功能面照常，但外部探查/深度覆盖能力被主动切断（本台仍用受信任内部引用观察）']
        : undefined,
    }
  },
}

// ── ② 内容投影 ───────────────────────────────────────────────────────────────
const slotsCheck: CheckDef = {
  id: 'slots',
  title: '② 内容投影（slot）',
  principle:
    '投影不是“把节点搬进 shadow DOM”：light DOM 节点始终留在宿主上，渲染时才被同名 <slot> 接走。' +
    'shadow 树里若没有同名 slot，节点仍在 DOM 中、仍占内存，却永远不渲染 —— 最典型的静默丢失。' +
    '具名 slot 的回退内容只在无人投影时显示；嵌套 slot 可以桥接新旧槽位。',
  expected: '旧宿主的 <span slot="header"> 被接收渲染；默认 slot 正文显示。',
  check(ctx) {
    const contract = getContract(ctx.runtime.version)
    const probe = probeCard(ctx.card)
    const traces: string[] = []
    const assertions: CheckAssertion[] = []

    const defaultSlot = probe.slots.find((s) => s.name === '(default)')
    assertions.push({
      name: '默认 slot 正文',
      expected: '1 个投影节点（<p> 正文）',
      actual: defaultSlot
        ? `${defaultSlot.assigned.length} 个节点${defaultSlot.fallbackShown ? '（显示回退）' : ''}`
        : '未找到默认 slot',
      verdict: defaultSlot && defaultSlot.assigned.length > 0 ? 'pass' : 'fail',
    })

    const headerSlot = probe.slots.find((s) => s.name === 'header')
    let verdict: Verdict
    let actual: string

    if (contract.kind === 'legacy') {
      verdict = headerSlot && headerSlot.assigned.length > 0 ? 'pass' : 'loss'
      actual =
        headerSlot && headerSlot.assigned.length > 0
          ? `header slot 接收 ${headerSlot.assigned.length} 个旧投影节点`
          : '模板未渲染 header 插槽：旧 span 留在 light DOM 永不显示'
    } else if (contract.kind === 'breaking') {
      verdict = 'loss'
      actual =
        '槽位已改名 titlebar（renamedFrom=header）。旧 span 仍在 light DOM，但没有 <slot name="header"> 接收；' +
        'titlebar 只显示回退文案。DOM 里节点还在、无任何报错。'
      traces.push('业务侧把 slot="header" 改成 titlebar 即可恢复 —— 但那是改写业务，不是组件向后兼容')
    } else {
      const bridged = headerSlot && headerSlot.assigned.length > 0
      verdict = bridged ? 'adapted' : 'loss'
      actual = bridged
        ? '适配层在 titlebar 的回退位嵌套 <slot name="header">：旧 span 经嵌套槽桥接显示'
        : '适配层未桥接旧 header 槽（可能被故障移除），旧投影静默丢失'
      if (bridged) traces.push('适配痕迹：shadow 模板内同时存在 titlebar 与 header 两个 slot（新旧双接收）')
    }

    assertions.push({
      name: '旧名具名槽 slot="header"',
      expected: '旧标题节点被渲染（v1 行为）',
      actual,
      verdict,
    })

    return {
      assertions,
      actual,
      evidence: { slots: probe.slots, lightChildren: probe.lightChildren, unassigned: probe.unassignedSlotted },
      adaptationTrace: traces.length ? traces : undefined,
    }
  },
}

// ── ③ 属性识别 ───────────────────────────────────────────────────────────────
const attributesCheck: CheckDef = {
  id: 'attributes',
  title: '③ 属性识别与回调',
  principle:
    'setAttribute 只保证字符串挂到元素上；只有名字进入 observedAttributes，attributeChangedCallback 才触发。' +
    '“元素带着属性”与“组件认识这个属性”是两回事：未知属性不报错、不触发回调、不影响内部，即静默丢失。' +
    'title 还与 HTMLElement 内置全局属性（浏览器原生 tooltip）撞名。',
  expected: '宿主的 setAttribute("title", …) 触发回调并驱动内部呈现。',
  act(ctx) {
    // 挂载时已有初始 title；再改一次值，强制经过一次实时回调
    ctx.card.setAttribute('title', '在线 title=实时改写')
  },
  check(ctx) {
    const contract = getContract(ctx.runtime.version)
    const probe = probeCard(ctx.card)
    const traces: string[] = []
    const observed = (ctx.card.constructor as unknown as { observedAttributes?: string[] }).observedAttributes ?? []
    const titleAttr = probe.attributes.find((a) => a.name === 'title')
    const headingAttr = probe.attributes.find((a) => a.name === 'heading')

    const assertions: CheckAssertion[] = [
      {
        name: '旧属性 title 挂在元素上',
        expected: 'title="…" 存在',
        actual: titleAttr ? `title="${titleAttr.value}"` : 'title 不存在',
        verdict: titleAttr ? 'pass' : 'fail',
      },
    ]

    let verdict: Verdict
    let actual: string
    if (contract.kind === 'legacy') {
      verdict = observed.includes('title') ? 'pass' : 'fail'
      actual = `observedAttributes=[${observed.join(', ')}]，实时改写触发回调，内部按 title 更新`
    } else if (contract.kind === 'breaking') {
      verdict = 'loss'
      actual = `observedAttributes=[${observed.join(', ')}] 不含 title：setAttribute 不触发任何回调。属性静静挂着（还被浏览器当原生 tooltip），组件只读 heading。`
      traces.push('无异常无警告；业务唯一的信号是标题 UI 没更新')
    } else {
      verdict = titleAttr && headingAttr?.value === titleAttr.value ? 'adapted' : 'loss'
      actual = `适配层观察旧名 title：回调转发并补反射 heading="${headingAttr?.value ?? ''}"，内部呈现同步更新`
      traces.push('适配痕迹：observedAttributes 同时含新旧名；回调内执行 setAttribute("heading", v)')
    }
    assertions.push({
      name: '旧属性被组件识别并驱动内部',
      expected: 'attributeChangedCallback(title) 触发',
      actual,
      verdict,
    })

    return {
      assertions,
      actual,
      evidence: {
        observedAttributes: observed,
        attributes: probe.attributes,
        compatLogs: ctx.logs.filter((l) => l.phase === 'compat').map((l) => l.message),
      },
      adaptationTrace: traces.length ? traces : undefined,
    }
  },
}

// ── ④ Property 与反射 ────────────────────────────────────────────────────────
const propertiesCheck: CheckDef = {
  id: 'properties',
  title: '④ Property 读写与属性反射',
  principle:
    '规范的自定义元素维护 attribute↔property 双向同步。宿主侧的 [attr] 选择器、querySelector、e2e 断言都站在 attribute 一侧：' +
    'property 写了却不反射，样式与选择器静默失效。另一个陷阱：未定义的旧名 property 沿原型链命中 HTMLElement 内置 title，' +
    '写入“成功”，语义却完全不同。',
  expected: '宿主写旧名 el.title 同步内部与属性；当前版新名 property 正常反射。',
  act(ctx) {
    ;(ctx.card as unknown as { title: string }).title = '属性反射探针·旧名'
    const contract = getContract(ctx.runtime.version)
    const newName = contract.kind === 'legacy' ? 'title' : 'heading'
    ;(ctx.card as unknown as Record<string, string>)[newName] = '属性反射探针·新名'
  },
  check(ctx) {
    const contract = getContract(ctx.runtime.version)
    const probe = probeCard(ctx.card)
    const traces: string[] = []
    const titleAttr = probe.attributes.find((a) => a.name === 'title')
    const headingAttr = probe.attributes.find((a) => a.name === 'heading')
    const reflectBlocked = ctx.runtime.faults.has('noAttrReflect')

    const assertions: CheckAssertion[] = []
    let legacyVerdict: Verdict
    let legacyActual: string
    if (contract.kind === 'legacy') {
      legacyVerdict = titleAttr?.value === '属性反射探针·新名' ? 'pass' : 'loss'
      legacyActual = `自定义 title 访问器：旧名即本名，反射 title="${titleAttr?.value ?? ''}"`
    } else if (contract.kind === 'breaking') {
      legacyVerdict = 'loss'
      legacyActual =
        titleAttr?.value === '属性反射探针·旧名'
          ? 'el.title 命中 HTMLElement 内置属性：title attribute 被改成探针值，但组件只认 heading，内部毫无反应'
          : '旧名 title 没有组件级访问器，数据写进了组件不读的地方'
      traces.push('语法合法、零报错 —— 这是 property 侧的静默丢失')
    } else {
      const ok = headingAttr?.value === '属性反射探针·新名'
      legacyVerdict = ok ? 'adapted' : 'loss'
      legacyActual = ok
        ? '旧名 title 是别名访问器：写入转发为 heading 并反射；随后新名写入为最终值'
        : '别名访问器存在，但转发/反射结果缺失'
      traces.push('适配痕迹：el.title 的 setter 内部改写 heading 并 setAttribute("heading")')
    }
    assertions.push({
      name: '旧名 property el.title（宿主 v1 视角）',
      expected: '写入驱动内部并反射',
      actual: legacyActual,
      verdict: legacyVerdict,
    })

    const newName = contract.kind === 'legacy' ? 'title' : 'heading'
    const newAttr = probe.attributes.find((a) => a.name === newName)
    assertions.push({
      name: `当前版 property el.${newName}`,
      expected: `写入后 ${newName} 属性同步`,
      actual: newAttr ? `${newName}="${newAttr.value}"` : `property 已写但属性面无 ${newName}`,
      verdict: newAttr && !reflectBlocked ? 'pass' : reflectBlocked ? 'loss' : 'fail',
    })
    if (reflectBlocked) {
      traces.push('故障 noAttrReflect：property 写入成功但 setAttribute 被跳过，[heading] 选择器与宿主样式静默失效')
    }

    return {
      assertions,
      actual: legacyActual,
      evidence: { attributes: probe.attributes, props: probe.props, reflectionBlocked: reflectBlocked },
      adaptationTrace: traces.length ? traces : undefined,
    }
  },
}

// ── ⑤ 事件传播（核心缺陷）────────────────────────────────────────────────────
const eventsCheck: CheckDef = {
  id: 'events',
  title: '⑤ 提交事件跨越 shadow 边界',
  principle:
    'Shadow DOM 改写事件传播：composed=false 的事件在 shadow root 边界终止 —— 实测连 host 元素自身都收不到，' +
    '更到不了业务宿主（React 事件委托挂在 root/容器，同样在边界之外）。composed=true 冒泡时被 retarget 为 host 继续上行。' +
    '事件改名是第二层断裂：即便 composed，旧名监听也匹配不上。两层叠加且都不报错 —— 这就是“按钮有反应、宿主失联”。',
  expected: '点击 shadow 内部“提交”后，业务宿主的 card-submit 监听器应收到事件。',
  act(ctx) {
    clickInternalSubmit(ctx.card)
  },
  check(ctx) {
    const contract = getContract(ctx.runtime.version)
    const probe = probeCard(ctx.card)
    const traces: string[] = []
    const received = ctx.hostEvents
    const gotLegacy = received.some((e) => e.type === 'card-submit')
    const stopped = ctx.runtime.faults.has('stopPropagation')
    const composedFault = ctx.runtime.faults.has('dropSubmitComposed')
    const internalEvt = probe.dispatches.find((d) => d.target === 'internal-button')
    const aliasEvt = probe.dispatches.find((d) => d.via === 'compat-alias')

    const assertions: CheckAssertion[] = [
      {
        name: '内部按钮确实派发事件',
        expected: '点击产生 1 次 CustomEvent',
        actual: internalEvt
          ? `${internalEvt.event}（bubbles=${internalEvt.bubbles}, composed=${internalEvt.composed}）${
              internalEvt.stopped ? '，未到达 host' : ''
            }`
          : '没有派发记录',
        verdict: internalEvt ? 'pass' : 'fail',
      },
    ]

    let verdict: Verdict
    let actual: string
    if (stopped) {
      verdict = 'fail'
      actual = '事件在 shadow root 被 stopPropagation() 显式截停：host 与业务宿主都收不到（有拦截日志，属显式失败而非静默丢失）'
    } else if (contract.kind === 'legacy') {
      if (gotLegacy) {
        verdict = 'pass'
        actual = 'card-submit(composed=true) 经 retarget 冒泡到业务宿主，旧监听命中'
      } else {
        verdict = 'loss'
        actual = '名字与监听一致，但故障把 composed 压成 false：事件止步 shadow root，业务宿主静默收不到'
      }
    } else if (contract.kind === 'breaking') {
      verdict = 'loss'
      actual =
        '两层静默断裂：①事件改名 submit，宿主监听 card-submit；②composed=false，事件止步 shadow root（host 自己都收不到）。' +
        '内部日志正常、外部零报错。'
      traces.push('只改监听名不够：宿主改听 submit 仍收不到，必须同时 composed:true 或在 host 重新派发')
    } else {
      if (gotLegacy && aliasEvt) {
        verdict = 'adapted'
        actual =
          '适配层在 host 重新派发 card-submit(composed=true, detail.via=compat-alias)：业务宿主旧监听原样命中，detail 可辨来源'
        traces.push('适配痕迹：宿主收到的是重新派发的合成别名事件，多一次派发是可见成本；detail.via 用于与原生事件区分')
      } else {
        verdict = 'loss'
        actual = '适配层补发未发生，旧监听未命中'
      }
    }

    const last = received[received.length - 1]
    assertions.push({
      name: '业务宿主 card-submit 监听命中',
      expected: 'hostEvents 至少 1 条 card-submit',
      actual: gotLegacy ? `命中；composedPath：${last.path}` : `未命中（hostEvents 共 ${received.length} 条）`,
      verdict,
    })
    void composedFault

    return {
      assertions,
      actual,
      evidence: { dispatches: probe.dispatches, hostReceived: received },
      adaptationTrace: traces.length ? traces : undefined,
    }
  },
}

// ── ⑥ CSS parts ──────────────────────────────────────────────────────────────
const partsCheck: CheckDef = {
  id: 'parts',
  title: '⑥ CSS ::part 样式暴露',
  principle:
    'shadow 内外样式隔离，外部唯一的官方穿透通道是 ::part(导出名单)。内部元素的 part 属性是白名单：' +
    'part 改名或不导出，旧 ::part() 规则匹配为空，浏览器静默丢弃该声明 —— 不报错、不继承、不回退。',
  expected: '宿主旧规则 ::part(submit-button) 仍命中内部提交按钮。',
  check(ctx) {
    const contract = getContract(ctx.runtime.version)
    const traces: string[] = []
    const tag = ctx.card.tagName.toLowerCase()
    const btn = getInternal(ctx.card)?.btn

    // 用一个绝无冲突的 outline 颜色探针，直接检验“旧 part 名是否仍被导出并接受外部样式”
    const probeStyle = document.createElement('style')
    probeStyle.textContent = `.business-host ${tag}::part(submit-button){outline:3px solid rgb(1,2,3)!important}`
    ctx.host.appendChild(probeStyle)
    void ctx.card.offsetWidth // 强制样式计算
    const cs = btn ? getComputedStyle(btn) : null
    const oldPartStyled = cs?.outlineColor.replace(/\s/g, '') === 'rgb(1,2,3)'
    probeStyle.remove()

    const probe = probeCard(ctx.card)
    const assertions: CheckAssertion[] = [
      {
        name: 'part 白名单导出',
        expected: '内部按钮导出 submit-button',
        actual: `part="[${probe.parts.join(', ') || '∅'}]"`,
        verdict: probe.parts.includes('submit-button')
          ? contract.kind === 'compat'
            ? 'adapted'
            : 'pass'
          : 'loss',
      },
      {
        name: '旧规则 ::part(submit-button) 实际生效',
        expected: 'outlineColor = rgb(1,2,3)',
        actual: oldPartStyled ? '命中：rgb(1, 2, 3)' : `未命中（outlineColor=${cs?.outlineColor ?? '?'}）`,
        verdict: oldPartStyled ? (contract.kind === 'compat' ? 'adapted' : 'pass') : 'loss',
      },
    ]

    let actual: string
    if (ctx.runtime.faults.has('hideSubmitPart')) {
      actual = '故障 hideSubmitPart：内部按钮不导出任何 part，新旧 ::part 规则全部静默失效。'
    } else if (contract.kind === 'legacy') {
      actual = `旧 part 正常导出，旧规则命中；按钮背景 ${cs?.backgroundColor}（宿主旧样式绿色 #16a34a）`
    } else if (contract.kind === 'breaking') {
      actual = `part 已改名 submit：旧 ::part(submit-button) 匹配为空被静默丢弃；命中的是新名蓝色规则（背景 ${cs?.backgroundColor}）。`
      traces.push('::part 不能跨 shadow 继承，也没有“未知 part”警告 —— 与未知属性同属静默丢失')
    } else {
      actual = `按钮双导出 submit/submit-button，旧规则 outline 探针命中（背景 ${cs?.backgroundColor}，新旧规则级联）。`
      traces.push('适配痕迹：内部按钮 part="submit submit-button" 双导出')
    }

    return {
      assertions,
      actual,
      evidence: { parts: probe.parts, oldPartStyled, buttonBackground: cs?.backgroundColor ?? '' },
      adaptationTrace: traces.length ? traces : undefined,
    }
  },
}

export const CHECKS: CheckDef[] = [
  mountCheck,
  slotsCheck,
  attributesCheck,
  propertiesCheck,
  eventsCheck,
  partsCheck,
]

export const STEP_META = CHECKS.map((c) => ({ id: c.id, title: c.title }))

/**
 * 在给定舞台上启动会话，并从第 1 步执行到 target（含）。
 * 单步执行时重放前置动作；自动执行时 target='parts' 一次跑满。
 */
export function runUntil(
  target: CheckId,
  opts: { version: string; faults: FaultSet; stage: HTMLElement },
): CheckSession {
  const ctx = mountBench({ version: opts.version, faults: opts.faults, stage: opts.stage })
  const results: Partial<Record<CheckId, StepResult>> = {}
  for (const def of CHECKS) {
    try {
      def.act?.(ctx)
      const out = def.check(ctx)
      results[def.id] = {
        id: def.id,
        title: def.title,
        verdict: aggregate(out.assertions),
        principle: def.principle,
        expected: def.expected,
        actual: out.actual,
        assertions: out.assertions,
        evidence: out.evidence,
        adaptationTrace: out.adaptationTrace,
        ranAt: Date.now(),
      }
    } catch (err) {
      results[def.id] = {
        id: def.id,
        title: def.title,
        verdict: 'fail',
        principle: def.principle,
        expected: def.expected,
        actual: `检查执行异常：${(err as Error).message}`,
        assertions: [],
        evidence: { error: (err as Error).stack },
        ranAt: Date.now(),
      }
    }
    if (def.id === target) break
  }
  return {
    ctx,
    results,
    teardown: () => ctx.teardown(),
  }
}

export function overallVerdict(results: Partial<Record<CheckId, StepResult>>): Verdict | null {
  const vals = CHECKS.map((c) => results[c.id]?.verdict).filter((v): v is Verdict => !!v)
  return vals.length ? vals.reduce(worst) : null
}
