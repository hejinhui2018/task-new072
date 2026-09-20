// ─────────────────────────────────────────────────────────────────────────────
// 自定义元素注册中心：三个版本各一个标签、各一份类
// （HMR/重复加载时不重复 define）
// ─────────────────────────────────────────────────────────────────────────────

import { createCardClass } from './createCard'
import { CONTRACTS } from '../contract/versions'

export interface RegisteredElement {
  tag: string
  version: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctor: CustomElementConstructor
}

const registered = new Map<string, RegisteredElement>()

for (const contract of CONTRACTS) {
  if (!customElements.get(contract.tag)) {
    const ctor = createCardClass(contract)
    customElements.define(contract.tag, ctor)
  }
  registered.set(contract.version, {
    tag: contract.tag,
    version: contract.version,
    ctor: customElements.get(contract.tag)!,
  })
}

export function getRegistered(version: string): RegisteredElement {
  return registered.get(version) ?? registered.get('v1')!
}

/**
 * 升级边界测试专用：为指定版本生成一个“尚未注册”的全新标签与类。
 * 调用方先把元素挂进 DOM（未升级形态），再调 defineFreshTag 完成升级。
 */
let upgradeSeq = 0
export function makeFreshTag(version: string): { tag: string; ctor: CustomElementConstructor } {
  const contract = CONTRACTS.find((c) => c.version === version)!
  const ctor = createCardClass(contract)
  const tag = `up-card-${version.replace('+', 'p')}-${++upgradeSeq}`
  return { tag, ctor }
}

export function defineFreshTag(tag: string, ctor: CustomElementConstructor): Promise<void> {
  customElements.define(tag, ctor)
  return customElements.whenDefined(tag).then(() => undefined)
}
