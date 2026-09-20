import type { VersionContract, VersionId } from './types';

/**
 * v1「旧版」组件：业务页面当前依赖的契约
 *  - slot 名：actions（旧），v2 改名为 footer
 *  - 提交事件：form-submit（旧），v2 改名为 submit
 *  - 属性：disabled 反射
 *  - CSS parts：submit-button（旧），v2 改名为 submit
 *  - property：loading
 */
export const V1: VersionContract = {
  version: 'v1',
  tag: 'order-form-v1',
  label: 'order-form v1（旧契约）',
  slots: [
    { name: '', label: '默认 slot · 订单正文', required: true },
    { name: 'actions', label: 'actions · 操作区' },
  ],
  attributes: [
    { name: 'title', label: 'title', type: 'string', property: 'title', reflects: true },
    { name: 'disabled', label: 'disabled', type: 'boolean', property: 'disabled', reflects: true },
    { name: 'size', label: 'size', type: 'string', property: 'size', reflects: true },
  ],
  properties: [
    { name: 'title', label: 'title: string', type: 'string' },
    { name: 'disabled', label: 'disabled: boolean', type: 'boolean' },
    { name: 'size', label: 'size: string', type: 'string' },
    { name: 'loading', label: 'loading: boolean（不反射）', type: 'boolean' },
    { name: 'version', label: 'version: string（只读）', type: 'string', readOnly: true },
  ],
  events: [
    {
      name: 'form-submit',
      label: 'form-submit',
      bubbles: true,
      composed: true,
      detail: '{ orderId, by }',
    },
    { name: 'form-change', label: 'form-change', bubbles: true, composed: true, detail: '{ qty }' },
  ],
  parts: [
    { name: 'submit-button', label: 'submit-button', expose: '提交按钮' },
    { name: 'panel', label: 'panel', expose: '外壳容器' },
  ],
  cssVars: ['--brand', '--radius'],
};

/**
 * v2「新版」组件：设计系统升级后的契约
 *  - slot actions -> footer
 *  - 事件 form-submit -> submit（且默认 composed，故障注入时可降级）
 *  - 新增 part submit（旧名 submit-button 移除）
 *  - 属性：title/disabled 保留反射；size 改为 property-only（不再反射）
 *  - property：新增 readOnly
 */
export const V2: VersionContract = {
  version: 'v2',
  tag: 'order-form-v2',
  label: 'order-form v2（新契约）',
  slots: [
    { name: '', label: '默认 slot · 订单正文', required: true },
    { name: 'footer', label: 'footer · 操作区（旧名 actions）' },
  ],
  attributes: [
    { name: 'title', label: 'title', type: 'string', property: 'title', reflects: true },
    { name: 'disabled', label: 'disabled', type: 'boolean', property: 'disabled', reflects: true },
  ],
  properties: [
    { name: 'title', label: 'title: string', type: 'string' },
    { name: 'disabled', label: 'disabled: boolean', type: 'boolean' },
    { name: 'size', label: 'size: string（不再反射到 attribute）', type: 'string' },
    { name: 'loading', label: 'loading: boolean（不反射）', type: 'boolean' },
    { name: 'readOnly', label: 'readOnly: boolean', type: 'boolean' },
    { name: 'version', label: 'version: string（只读）', type: 'string', readOnly: true },
  ],
  events: [
    {
      name: 'submit',
      label: 'submit（旧名 form-submit）',
      bubbles: true,
      composed: true,
      detail: '{ orderId, by }',
    },
    { name: 'form-change', label: 'form-change', bubbles: true, composed: true, detail: '{ qty }' },
  ],
  parts: [
    { name: 'submit', label: 'submit（旧名 submit-button）', expose: '提交按钮' },
    { name: 'panel', label: 'panel', expose: '外壳容器' },
  ],
  cssVars: ['--brand', '--radius'],
};

export const CONTRACTS: Record<VersionId, VersionContract> = { v1: V1, v2: V2 };

/** 业务页面（宿主）仍然按 v1 契约编写 */
export const HOST_VERSION: VersionId = 'v1';

export interface Renames {
  slots: Record<string, string>;
  events: Record<string, string>;
  parts: Record<string, string>;
}

/** v1 -> v2 改名映射，宿主适配层据此桥接 */
export const RENAMES_V1_TO_V2: Renames = {
  slots: { actions: 'footer' },
  events: { 'form-submit': 'submit' },
  parts: { 'submit-button': 'submit' },
};
