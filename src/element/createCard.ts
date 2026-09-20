// ─────────────────────────────────────────────────────────────────────────────
// 真实自定义元素工厂：三个版本共用一套内核，按契约生成差异
// 元素内部维护 BenchRuntime（日志 / 派发回执）与 WeakMap 内部引用
// 外部代码只能拿到标准平台 API（el.shadowRoot、addEventListener、::part …），
// 验收引擎通过受信任的内部引用来“解释”边界两侧各发生了什么
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentContract, FaultKey, LogEntry } from '../contract/types'

export interface DispatchReceipt {
  event: string
  bubbles: boolean
  composed: boolean
  target: 'internal-button' | 'host'
  via?: string
  stopped: boolean
  at: number
}

export interface BenchRuntime {
  instanceId: string
  version: string
  faults: Set<FaultKey>
  dispatches: DispatchReceipt[]
  log: (phase: LogEntry['phase'], message: string, level?: LogEntry['level']) => void
}

interface Internal {
  root: ShadowRoot
  btn: HTMLButtonElement
  slots: HTMLSlotElement[]
  runtime: BenchRuntime
  connected: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any
  /** attribute→property 入站：只写存储与呈现，不反射（调用方已持有 attribute） */
  ingest: (prop: string, value: unknown, headingText?: string) => void
}

const internals = new WeakMap<HTMLElement, Internal>()

// 升级边界测试用：元素在 define 之前只是 HTMLUnknownElement，无法调用实例方法，
// 因此通过节点级 WeakMap 预置 runtime，connectedCallback 升级瞬间读取
const prebound = new WeakMap<HTMLElement, BenchRuntime>()
export function prebindRuntime(el: HTMLElement, runtime: BenchRuntime) {
  prebound.set(el, runtime)
}

// 故障 sharedState 的“模块级单例”：所有实例共享一个存储桶
const sharedStore: Record<string, unknown> = { heading: '', title: '' }
export function resetSharedStore() {
  sharedStore.heading = ''
  sharedStore.title = ''
}

/** 供验收引擎使用的内部引用（closed 模式下外部拿不到，但引擎是受信任的观察方） */
export function getInternal(el: HTMLElement): Internal | undefined {
  return internals.get(el)
}

function buildShadow(contract: ComponentContract, runtime: BenchRuntime): {
  root: ShadowRoot
  btn: HTMLButtonElement
  slots: HTMLSlotElement[]
} {
  const host = (runtime as unknown as { __host: HTMLElement }).__host
  const closed = runtime.faults.has('closedShadow')
  const root = host.attachShadow({ mode: closed ? 'closed' : 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host { display:block; border:1px solid #475569; border-radius:12px;
           background:#1e293b; color:#e2e8f0; font:14px/1.5 system-ui; overflow:hidden; }
    :host([disabled]) { opacity:.5; }
    .bar { display:flex; align-items:center; gap:8px; padding:10px 14px;
           border-bottom:1px solid #334155; font-weight:600; min-height:20px; }
    .body { padding:12px 14px; }
    .actions { padding:0 14px 12px; }
    button { background:#64748b; color:#fff; border:0; border-radius:8px;
             padding:6px 16px; font:inherit; cursor:pointer; }
    button:active { transform:translateY(1px); }
  `
  root.append(style)

  const bar = document.createElement('div')
  bar.className = 'bar'
  const dropHeader = runtime.faults.has('dropHeaderSlot')

  if (contract.kind === 'legacy') {
    if (!dropHeader) {
      const s = document.createElement('slot')
      s.name = 'header'
      s.textContent = '默认标题'
      bar.append(s)
    }
  } else if (contract.kind === 'breaking') {
    if (!dropHeader) {
      const s = document.createElement('slot')
      s.name = 'titlebar'
      s.textContent = '默认标题'
      bar.append(s)
    }
  } else {
    // 兼容适配层：titlebar 的回退内容里嵌套旧名 header 插槽
    // 新槽有内容 -> 显示新槽；新槽为空 -> 回退到旧槽；都空 -> 文案兜底
    // 故障 dropHeaderSlot：适配层漏掉旧槽桥接（适配不完整时的静默丢失）
    const titlebar = document.createElement('slot')
    titlebar.name = 'titlebar'
    if (!dropHeader) {
      const legacy = document.createElement('slot')
      legacy.name = 'header'
      legacy.textContent = '默认标题'
      titlebar.append(legacy)
    } else {
      titlebar.textContent = '默认标题'
    }
    bar.append(titlebar)
  }

  const body = document.createElement('div')
  body.className = 'body'
  const defaultSlot = document.createElement('slot')
  body.append(defaultSlot)

  const actions = document.createElement('div')
  actions.className = 'actions'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '提交'
  const hidePart = runtime.faults.has('hideSubmitPart')
  if (!hidePart) {
    if (contract.kind === 'legacy') btn.part.add('submit-button')
    else if (contract.kind === 'breaking') btn.part.add('submit')
    else btn.part.add('submit', 'submit-button') // 适配层：新旧 part 双导出
  }
  actions.append(btn)

  root.append(bar, body, actions)
  const slots = Array.from(root.querySelectorAll('slot'))
  return { root, btn, slots }
}

export function createCardClass(contract: ComponentContract) {
  const legacyAttrs = contract.attributes
    .filter((a) => a.renamedFrom)
    .map((a) => a.renamedFrom as string)

  class SlotCard extends HTMLElement {
    static get observedAttributes(): string[] {
      const names = contract.attributes.map((a) => a.name)
      // 适配层额外监听旧属性名；v2 裸奔版不认识旧名
      return contract.kind === 'compat' ? [...names, ...legacyAttrs] : names
    }

    /** 必须在 connectedCallback 之前由装配代码注入 */
    __bindRuntime(runtime: BenchRuntime) {
      ;(runtime as unknown as { __host: HTMLElement }).__host = this
      internals.set(this, {
        root: undefined as unknown as ShadowRoot,
        btn: undefined as unknown as HTMLButtonElement,
        slots: [],
        runtime,
        connected: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store: null as any,
        ingest: () => {},
      })
    }

    connectedCallback() {
      let internal = internals.get(this)
      // 升级路径：元素先以未升级形态存在，define 时才升级到这里
      if (!internal) {
        const runtime = prebound.get(this)
        if (!runtime) return
        ;(runtime as unknown as { __host: HTMLElement }).__host = this
        internal = {
          root: undefined as unknown as ShadowRoot,
          btn: undefined as unknown as HTMLButtonElement,
          slots: [],
          runtime,
          connected: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store: null as any,
          ingest: () => {},
        }
        internals.set(this, internal)
        prebound.delete(this)
      }
      // 重连：同一节点移出再插入时 shadow 树与监听都还在，绝不能再次 attachShadow
      if (internal.connected) return
      if (internal.root) {
        internal.connected = true
        internal.runtime.log('element', '元素重新插入文档：复用既有 shadow 树与监听', 'info')
        return
      }
      internal.connected = true

      const { root, btn, slots } = buildShadow(contract, internal.runtime)
      internal.root = root
      internal.btn = btn
      internal.slots = slots

      const noReflect = internal.runtime.faults.has('noAttrReflect')
      const useShared = internal.runtime.faults.has('sharedState')
      internal.store = useShared ? sharedStore : internal

      // 内部按钮 -> 契约事件
      btn.addEventListener('click', () => this.__emitSubmit())

      // 属性 -> 内部呈现
      const renderHeading = (text: string | null) => {
        btn.setAttribute('aria-label', `提交：${text ?? '未命名'}`)
      }
      renderHeading(this.getAttribute(contract.kind === 'legacy' ? 'title' : 'heading'))

      internal.runtime.log(
        'element',
        `connectedCallback：shadow(${root.mode}) 已挂载，part=[${btn.part.value || '∅'}]`,
        'info',
      )

      // ── property 访问器按版本安装到实例 ──
      const store = internal.store
      // 反射前比对现值，避免与 attributeChangedCallback 相互触发
      const reflect = (attr: string, value: string | null) => {
        const current = value === null ? null : this.getAttribute(attr)
        if (current === value) return
        if (noReflect) {
          internal.runtime.log(
            'element',
            `property 已写入，但反射被关闭：setAttribute("${attr}") 未执行`,
            'warn',
          )
          return
        }
        if (value === null) this.removeAttribute(attr)
        else this.setAttribute(attr, value)
      }

      // 属性回调的“入站”路径：只写存储与呈现，不再反射 —— 杜绝回调↔setter 递归
      const ingest = (prop: string, value: unknown, headingText?: string) => {
        store[prop] = value
        if (headingText !== undefined) renderHeading(headingText)
      }
      internal.ingest = ingest

      const defineStringProp = (prop: string, attr: string, legacy = false) => {
        Object.defineProperty(this, prop, {
          configurable: true,
          enumerable: true,
          get: () => (store[prop] as string) ?? '',
          set: (v: string) => {
            store[prop] = v
            if (legacy) {
              internal.runtime.log(
                'compat',
                `旧 property "${prop}" 写入 -> 转发为新 property "${contract.properties[0].name}"`,
                'ok',
              )
              store[contract.properties[0].name] = v
            }
            reflect(attr, String(v))
            renderHeading(String(v))
          },
        })
      }
      const defineBoolProp = (prop: string, attr: string) => {
        Object.defineProperty(this, prop, {
          configurable: true,
          enumerable: true,
          get: () => store[prop] === true,
          set: (v: boolean) => {
            store[prop] = !!v
            reflect(attr, v ? '' : null)
          },
        })
      }

      if (contract.kind === 'legacy') {
        defineStringProp('title', 'title')
        defineBoolProp('disabled', 'disabled')
      } else if (contract.kind === 'breaking') {
        defineStringProp('heading', 'heading')
        defineBoolProp('disabled', 'disabled')
      } else {
        defineStringProp('heading', 'heading')
        defineBoolProp('disabled', 'disabled')
        defineStringProp('title', 'heading', true) // 旧名别名
      }

      // 连接时把“升级前/挂载前”已存在的 attribute 静默播种到 property
      for (const a of contract.attributes) {
        if (!this.hasAttribute(a.name)) continue
        const v = a.type === 'boolean' ? true : this.getAttribute(a.name) ?? ''
        internal.store[a.reflects] = v
      }
      if (contract.kind === 'compat' && this.hasAttribute('title')) {
        const t = this.getAttribute('title') ?? ''
        internal.store.title = t
        internal.store.heading = t
      }
    }

    disconnectedCallback() {
      const internal = internals.get(this)
      if (!internal) return
      internal.connected = false
      internal.runtime.log('element', 'disconnectedCallback：元素移出文档，shadow 树保留', 'warn')
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      const internal = internals.get(this)
      if (!internal?.connected) return
      const legacySpec = contract.attributes.find((a) => a.renamedFrom === name)
      if (legacySpec && contract.kind === 'compat') {
        internal.runtime.log(
          'compat',
          `attributeChangedCallback 识别旧属性 "${name}" -> 转发并反射为 "${legacySpec.name}"`,
          'ok',
        )
        // 转发为新属性；同值时反射守卫跳过重入，新属性回调经 ingest 同步内部
        if (value === null) this.removeAttribute(legacySpec.name)
        else this.setAttribute(legacySpec.name, value)
        // 旧名别名 property 同步（只写存储，绝不再 setAttribute，否则重入本回调）
        internal.ingest(
          legacySpec.reflects === 'heading' ? 'title' : legacySpec.reflects,
          value ?? '',
          value ?? '',
        )
      } else {
        const spec = contract.attributes.find((a) => a.name === name)
        if (spec) {
          const v = spec.type === 'boolean' ? this.hasAttribute(name) : value ?? ''
          // 入站同步：只写 property 存储与内部呈现，不反向 setAttribute（杜绝回调↔setter 递归）
          internal.ingest(spec.reflects, v, spec.type === 'boolean' ? undefined : value ?? '')
        }
        internal.runtime.log('element', `attributeChangedCallback：${name}=${value ?? 'null'}`, 'info')
      }
    }

    __emitSubmit() {
      const internal = internals.get(this)
      if (!internal) return
      const evName = contract.kind === 'legacy' ? 'card-submit' : 'submit'
      // 各版本基线：v1 composed=true；v2 composed=false（原生缺陷）；
      // v2+ 内核修复为 true，旧名靠 host 上的别名补发。
      // 故障 dropSubmitComposed 可把任何版本的内部事件压成 composed=false。
      const baseComposed = contract.kind === 'breaking' ? false : true
      const composed = baseComposed && !internal.runtime.faults.has('dropSubmitComposed')
      const intercepted = internal.runtime.faults.has('stopPropagation')
      const ev = new CustomEvent(evName, {
        bubbles: true,
        composed,
        detail: { source: 'internal-button' },
      })

      // stopPropagation 在 shadow root 上注册（捕获+冒泡两个阶段都拦）
      if (intercepted) {
        const stop = (e: Event) => {
          e.stopPropagation()
          internal.runtime.log('element', '内部拦截器在 shadow root 调用了 stopPropagation()', 'warn')
        }
        internal.root.addEventListener(evName, stop, true)
        internal.root.addEventListener(evName, stop)
      }

      let reachedHost = false
      const hostProbe = () => {
        reachedHost = true
      }
      // 与业务宿主一致：host 冒泡阶段监听
      this.addEventListener(evName, hostProbe)
      internal.btn.dispatchEvent(ev)
      this.removeEventListener(evName, hostProbe)

      internal.runtime.dispatches.push({
        event: evName,
        bubbles: true,
        composed,
        target: 'internal-button',
        stopped: !reachedHost,
        at: performance.now(),
      })
      internal.runtime.log(
        'element',
        `内部按钮派发 ${evName}（bubbles=true, composed=${composed}）` +
          (intercepted ? '；stopPropagation 生效，事件未到达 host' : ''),
        intercepted ? 'warn' : composed ? 'info' : 'warn',
      )

      // 适配层：无论内部事件能否穿越边界，都在 host 上重新派发一个 composed 的
      // 旧名别名事件（重新派发，而非转发）—— 这就是“适配”的可见成本与痕迹。
      // 唯一例外：内部显式 stopPropagation（业务取消提交语义），适配层尊重该决定。
      if (contract.kind === 'compat') {
        if (internal.runtime.faults.has('stopPropagation')) {
          internal.runtime.dispatches.push({
            event: 'card-submit',
            bubbles: true,
            composed: true,
            target: 'host',
            via: 'compat-alias',
            stopped: true,
            at: performance.now(),
          })
          internal.runtime.log(
            'compat',
            '内部提交被 stopPropagation 标记为取消，适配层放弃补发 card-submit',
            'error',
          )
          return
        }
        const alias = new CustomEvent('card-submit', {
          bubbles: true,
          composed: true,
          detail: { source: 'internal-button', via: 'compat-alias' },
        })
        this.dispatchEvent(alias)
        internal.runtime.dispatches.push({
          event: 'card-submit',
          bubbles: true,
          composed: true,
          target: 'host',
          via: 'compat-alias',
          stopped: false,
          at: performance.now(),
        })
        internal.runtime.log(
          'compat',
          '适配层在 host 补发 card-submit（bubbles=true, composed=true）→ 可穿越边界',
          'ok',
        )
      }
    }

    /** 受信任探针：序列化元素两侧的真实状态 */
    __probe(): ElementProbe {
      const internal = internals.get(this)
      const root = internal?.root
      const slots =
        root?.querySelectorAll('slot') ? Array.from(root.querySelectorAll('slot')) : internal?.slots ?? []
      const assignedAnywhere = new Set<Node>()
      const slotInfo = slots.map((s) => {
        const nodes = s.assignedNodes()
        nodes.forEach((n) => assignedAnywhere.add(n))
        // flatten 后才能看穿“回退内容里嵌套了另一个 slot”的适配桥接：
        // titlebar 自身 assigned 为空，但其回退位的 header slot 接走了旧节点，不算显示文案回退
        const flat = s.assignedNodes({ flatten: true })
        const fallbackShown =
          nodes.length === 0 && flat.every((n) => n.nodeType === Node.TEXT_NODE)
        return {
          name: s.name || '(default)',
          assigned: nodes.map((n) => describeNode(n)),
          flattened: flat.map((n) => describeNode(n)),
          fallbackShown,
        }
      })
      const light = Array.from(this.children).map((c) => {
        const assigned = assignedAnywhere.has(c)
        return {
          tag: c.tagName.toLowerCase(),
          slot: c.getAttribute('slot') ?? '',
          text: c.textContent?.slice(0, 40) ?? '',
          assigned,
        }
      })
      const btn = internal?.btn
      return {
        instanceId: internal?.runtime.instanceId ?? '?',
        version: contract.version,
        connected: internal?.connected ?? false,
        shadowMode: (this.shadowRoot?.mode as string | undefined) ?? (root ? 'closed' : 'none'),
        externalShadowRoot: this.shadowRoot
          ? { mode: this.shadowRoot.mode, childCount: this.shadowRoot.childElementCount }
          : null,
        parts: btn ? btn.part.value.split(/\s+/).filter(Boolean) : [],
        slots: slotInfo,
        lightChildren: light,
        // 带 slot 名却没有任何 <slot> 接收的 light 子节点 —— 静默丢失的直接证据
        unassignedSlotted: light.filter((l) => l.slot && !l.assigned),
        attributes: Array.from(this.attributes).map((a) => ({ name: a.name, value: a.value })),
        props: {
          title: {
            // 必须查实例自身描述符：否则 'title' in this 会命中 HTMLElement 内置 title
            exists: Object.getOwnPropertyDescriptor(this, 'title') !== undefined,
            value: (this as unknown as { title?: unknown }).title ?? null,
          },
          heading: {
            exists: Object.getOwnPropertyDescriptor(this, 'heading') !== undefined,
            value: (this as unknown as { heading?: unknown }).heading ?? null,
          },
          disabled: {
            exists: Object.getOwnPropertyDescriptor(this, 'disabled') !== undefined,
            value: (this as unknown as { disabled?: unknown }).disabled ?? null,
          },
        },
        dispatches: internal?.runtime.dispatches ?? [],
        sharedHeading: (sharedStore.heading as string) ?? '',
        buttonBg: btn ? getComputedStyle(btn).backgroundColor : '',
      }
    }
  }

  return SlotCard
}

export interface ElementProbe {
  instanceId: string
  version: string
  connected: boolean
  shadowMode: string
  externalShadowRoot: { mode: string; childCount: number } | null
  parts: string[]
  slots: { name: string; assigned: string[]; flattened: string[]; fallbackShown: boolean }[]
  lightChildren: { tag: string; slot: string; text: string; assigned: boolean }[]
  unassignedSlotted: { tag: string; slot: string; text: string; assigned: boolean }[]
  attributes: { name: string; value: string }[]
  props: Record<string, { exists: boolean; value: unknown }>
  dispatches: DispatchReceipt[]
  sharedHeading: string
  buttonBg: string
}

function describeNode(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return `#text "${(n.textContent ?? '').trim().slice(0, 30)}"`
  const el = n as Element
  return `<${el.tagName.toLowerCase()}${el.getAttribute('slot') ? ` slot="${el.getAttribute('slot')}"` : ''}> ${
    (el.textContent ?? '').trim().slice(0, 28)
  }`
}
