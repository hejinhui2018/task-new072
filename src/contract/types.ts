// ─────────────────────────────────────────────────────────────────────────────
// SlotContract 契约模型
// 一个组件版本 = 一份完整契约：slots / attributes / properties / events / parts
// renamedFrom 记录“新名字 ← 旧名字”的沿革，是判定 pass / adapted / loss 的依据
// ─────────────────────────────────────────────────────────────────────────────

/** 验收结论四态：直接满足 / 兼容垫片满足 / 静默丢失 / 硬失败 */
export type Verdict = 'pass' | 'adapted' | 'loss' | 'fail'

export type VersionKind = 'legacy' | 'breaking' | 'compat'

export interface SlotSpec {
  name: string
  required?: boolean
  renamedFrom?: string
  fallback?: string
}

export interface AttrSpec {
  name: string
  type: 'string' | 'boolean' | 'number'
  renamedFrom?: string
  reflects: string // 对应的 property 名
}

export interface PropSpec {
  name: string
  type: string
  renamedFrom?: string
  reflectsToAttr?: string
}

export interface EventSpec {
  name: string
  bubbles: boolean
  composed: boolean
  renamedFrom?: string
  detail: string
}

export interface PartSpec {
  name: string
  renamedFrom?: string
}

export interface ComponentContract {
  version: string
  label: string
  tag: string
  kind: VersionKind
  slots: SlotSpec[]
  attributes: AttrSpec[]
  properties: PropSpec[]
  events: EventSpec[]
  parts: PartSpec[]
  /** 相对 v1 的变更说明 */
  changes: string[]
}

// ── 故障注入 ──────────────────────────────────────────────────────────────────

export type FaultKey =
  | 'closedShadow' // ShadowRoot mode=closed，外部探查被切断
  | 'dropSubmitComposed' // submit 事件 composed=false（v2 的原生缺陷，也可手动注入）
  | 'stopPropagation' // 内部拦截：submit 在 shadow 边界内被截停
  | 'dropHeaderSlot' // header 槽位在模板中缺失
  | 'hideSubmitPart' // submit-button part 不再导出
  | 'noAttrReflect' // property 变更不反射回 attribute
  | 'sharedState' // 模块级共享状态：多实例互相串数据

export interface FaultDef {
  key: FaultKey
  label: string
  detail: string
}

export const FAULTS: FaultDef[] = [
  {
    key: 'dropSubmitComposed',
    label: 'submit.composed=false',
    detail: '提交事件不穿越 shadow 边界：host 自身能收到，业务宿主（React 委托层）收不到',
  },
  {
    key: 'closedShadow',
    label: 'closed ShadowRoot',
    detail: 'shadowRoot 对外为 null，外部探针失效（::part 仍然有效）',
  },
  {
    key: 'stopPropagation',
    label: '内部 stopPropagation',
    detail: '提交事件在 shadow 树内部被截停，host 与业务宿主均收不到',
  },
  {
    key: 'dropHeaderSlot',
    label: 'header 槽位缺失',
    detail: '模板不再渲染 header 插槽，旧 light DOM 节点留在宿主上但永不显示',
  },
  {
    key: 'hideSubmitPart',
    label: '隐藏 submit part',
    detail: '内部按钮不再导出 part，外部 ::part(submit-button) 静默失效',
  },
  {
    key: 'noAttrReflect',
    label: 'property 不反射',
    detail: 'JS 写入 property 后 attribute 不更新，依赖属性选择器的宿主样式失效',
  },
  {
    key: 'sharedState',
    label: '多实例共享状态',
    detail: '状态写到模块级单例：后挂载的实例会读到前一个实例的数据',
  },
]

export type FaultSet = FaultKey[]

// ── 验收步骤结果 ──────────────────────────────────────────────────────────────

export type CheckId = 'mount' | 'slots' | 'attributes' | 'properties' | 'events' | 'parts'

export interface CheckAssertion {
  name: string
  expected: string
  actual: string
  verdict: Verdict
}

export interface StepResult {
  id: CheckId
  title: string
  verdict: Verdict
  /** 原理：这一步在 Web Components 模型里到底发生了什么 */
  principle: string
  expected: string
  actual: string
  assertions: CheckAssertion[]
  evidence: Record<string, unknown>
  /** 兼容适配的痕迹（区别于静默丢失的关键） */
  adaptationTrace?: string[]
  ranAt: number
  stale?: true
}

export type SuiteId = 'upgrade' | 'remount' | 'isolation'

export interface SuiteCaseResult {
  name: string
  version: string
  verdict: Verdict
  detail: string
  evidence?: Record<string, unknown>
}

export interface SuiteResult {
  id: SuiteId
  title: string
  principle: string
  cases: SuiteCaseResult[]
  ranAt: number
  stale?: true
}

export interface LogEntry {
  t: number
  phase: 'host' | 'element' | 'engine' | 'compat'
  message: string
  level: 'info' | 'warn' | 'error' | 'ok'
}

export interface InstanceConfig {
  version: string
  faults: FaultSet
  /** 业务宿主按哪一版契约写代码（固定 v1：模拟“多个业务页面仍依赖旧契约”） */
  hostContract: string
}
