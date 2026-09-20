// ─────────────────────────────────────────────────────────────────────────────
// 组件版本谱系：
//   slot-card@v1   —— 旧组件，业务页面当前依赖的契约（旧 slot 名 / 旧事件名 / 旧 part）
//   slot-card@v2   —— 升级后“裸奔”版本：重命名 + 事件去掉 composed，旧宿主静默失联
//   slot-card@v2+  —— v2 内核 + 兼容适配层：双 slot/双事件别名/双 part 导出
// 宿主代码始终按 v1 契约编写，用来检验升级是否真的向后兼容
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentContract } from './types'

export const HOST_CONTRACT_VERSION = 'v1'

export const v1Contract: ComponentContract = {
  version: 'v1',
  label: 'slot-card v1（旧版）',
  tag: 'slot-card-v1',
  kind: 'legacy',
  slots: [
    { name: 'header', required: true, fallback: '默认标题' },
    { name: '', fallback: '卡片正文' },
  ],
  attributes: [
    { name: 'title', type: 'string', reflects: 'title' },
    { name: 'disabled', type: 'boolean', reflects: 'disabled' },
  ],
  properties: [
    { name: 'title', type: 'string', reflectsToAttr: 'title' },
    { name: 'disabled', type: 'boolean', reflectsToAttr: 'disabled' },
  ],
  events: [
    {
      name: 'card-submit',
      bubbles: true,
      composed: true,
      detail: '{ source: "internal-button" }',
    },
  ],
  parts: [{ name: 'submit-button' }],
  changes: ['基线版本，业务页面按本版契约编写'],
}

export const v2Contract: ComponentContract = {
  version: 'v2',
  label: 'slot-card v2（破坏性升级）',
  tag: 'slot-card-v2',
  kind: 'breaking',
  slots: [
    // header 改名为 titlebar：旧宿主投进来的 <span slot="header"> 找不到接收方
    { name: 'titlebar', required: true, renamedFrom: 'header', fallback: '默认标题' },
    { name: '', fallback: '卡片正文' },
  ],
  attributes: [
    // title 改名为 heading
    { name: 'heading', type: 'string', renamedFrom: 'title', reflects: 'heading' },
    { name: 'disabled', type: 'boolean', reflects: 'disabled' },
  ],
  properties: [
    { name: 'heading', type: 'string', renamedFrom: 'title', reflectsToAttr: 'heading' },
    { name: 'disabled', type: 'boolean', reflectsToAttr: 'disabled' },
  ],
  events: [
    {
      // 事件改名，且 composed=false —— 这是“按钮能点、宿主收不到”的元凶
      name: 'submit',
      bubbles: true,
      composed: false,
      renamedFrom: 'card-submit',
      detail: '{ source: "internal-button" }',
    },
  ],
  parts: [
    // part 改名为 submit：旧宿主 ::part(submit-button) 静默失效
    { name: 'submit', renamedFrom: 'submit-button' },
  ],
  changes: [
    'slot header → titlebar',
    'attribute/property title → heading',
    '事件 card-submit → submit，且 composed 降为 false（不穿越 shadow 边界）',
    'CSS part submit-button → submit',
  ],
}

export const v2PlusContract: ComponentContract = {
  version: 'v2+',
  label: 'slot-card v2+（v2 内核 + 兼容适配层）',
  tag: 'slot-card-v2plus',
  kind: 'compat',
  // 契约同时列出新旧两个名字：旧宿主命中 renamedFrom 走适配路径
  slots: [
    { name: 'titlebar', required: true, renamedFrom: 'header', fallback: '默认标题' },
    { name: '', fallback: '卡片正文' },
  ],
  attributes: [
    { name: 'heading', type: 'string', renamedFrom: 'title', reflects: 'heading' },
    { name: 'disabled', type: 'boolean', reflects: 'disabled' },
  ],
  properties: [
    { name: 'heading', type: 'string', renamedFrom: 'title', reflectsToAttr: 'heading' },
    { name: 'disabled', type: 'boolean', reflectsToAttr: 'disabled' },
  ],
  events: [
    {
      name: 'submit',
      bubbles: true,
      // 适配层补发的 card-submit 别名事件 composed=true，可穿越边界
      composed: true,
      renamedFrom: 'card-submit',
      detail: '{ source: "internal-button", via: "compat-alias" }',
    },
  ],
  parts: [{ name: 'submit', renamedFrom: 'submit-button' }],
  changes: [
    '内核与 v2 完全一致',
    '适配层：模板同时渲染 header/titlebar 两个槽位（内部桥接）',
    '适配层：attributeChangedCallback 识别旧名 title 并转发 heading',
    '适配层：内部 submit(composed=false) 之后补发 card-submit(composed=true)',
    '适配层：内部按钮同时导出 submit 与 submit-button 两个 part',
  ],
}

export const CONTRACTS: ComponentContract[] = [v1Contract, v2Contract, v2PlusContract]

export function getContract(version: string): ComponentContract {
  return CONTRACTS.find((c) => c.version === version) ?? v1Contract
}
