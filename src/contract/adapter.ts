import type { VersionId } from './types';
import { RENAMES_V1_TO_V2 } from './contracts';

export interface AdapterStats {
  eventsTranslated: number;
  slotsBridged: number;
  attrsForwarded: number;
  styleShimInstalled: boolean;
  /** 被宿主监听、但适配层始终没等到的事件（无法从 shadow 外补救的证据） */
  missingEvents: string[];
}

declare global {
  interface HTMLElement {
    __adapterStats?: AdapterStats;
  }
}

const SHIM_STYLE_ID = 'host-compat-shim';

/**
 * 宿主 v1 -> 组件 v2 的兼容适配层。
 * 全部动作都发生在「宿主侧」：不改组件源码、不重新打包组件。
 * 返回 disposer。
 */
export function installAdapter(el: HTMLElement, host: VersionId, target: VersionId): () => void {
  if (host === target) return () => {};
  const renames = RENAMES_V1_TO_V2;
  const stats: AdapterStats = {
    eventsTranslated: 0,
    slotsBridged: 0,
    attrsForwarded: 0,
    styleShimInstalled: false,
    missingEvents: [],
  };
  el.__adapterStats = stats;

  // 1) 事件转译：新名 submit -> 旧名 form-submit，在宿主节点上重新派发
  //    注意：如果组件发出的事件 composed=false，它根本到不了宿主节点，
  //    适配层在 shadow 外无从监听——这正是「适配也救不了」的边界。
  const onNewSubmit = (ev: Event) => {
    stats.eventsTranslated += 1;
    el.dispatchEvent(
      new CustomEvent('form-submit', {
        bubbles: true,
        composed: true,
        detail: (ev as CustomEvent).detail,
      }),
    );
  };
  el.addEventListener('submit', onNewSubmit as EventListener);

  // 2) slot 桥接：把宿主仍按旧名投射的节点改挂到新具名 slot
  const bridgeOne = (node: Element) => {
    const oldName = node.getAttribute('slot');
    const newName = oldName ? renames.slots[oldName] : undefined;
    if (oldName && newName && node.getAttribute('slot') !== newName) {
      node.setAttribute('slot', newName);
      stats.slotsBridged += 1;
    }
  };
  Array.from(el.children).forEach(bridgeOne);
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => n.nodeType === 1 && bridgeOne(n as Element));
      if (rec.type === 'attributes' && rec.target.nodeType === 1) bridgeOne(rec.target as Element);
    }
  });
  mo.observe(el, { childList: true, attributes: true, attributeFilter: ['slot'], subtree: false });

  // 3) attribute -> property 转发：v2 移除的 size attribute 由 shim 同步写入 property。
  //    MutationObserver 是微任务异步的，宿主在 setAttribute 后立即读 property 会读到旧值——
  //    所以这里在实例上同步包装 setAttribute/removeAttribute（宿主适配垫片的真实做法）。
  const origSetAttribute = el.setAttribute.bind(el);
  const origRemoveAttribute = el.removeAttribute.bind(el);
  el.setAttribute = function patchedSetAttribute(name: string, value: string): void {
    origSetAttribute(name, value);
    if (name === 'size') {
      // @ts-expect-error 组件实例上的 size property
      el.size = value;
      stats.attrsForwarded += 1;
    }
  };
  el.removeAttribute = function patchedRemoveAttribute(name: string): void {
    origRemoveAttribute(name);
    if (name === 'size') {
      // @ts-expect-error 组件实例上的 size property
      el.size = null;
      stats.attrsForwarded += 1;
    }
  };
  // shim 安装晚于宿主初始 setAttribute 的补偿：把当前已落地的 size 补转发一次
  if (el.hasAttribute('size')) {
    // @ts-expect-error 组件实例上的 size property
    el.size = el.getAttribute('size');
    stats.attrsForwarded += 1;
  }

  // 4) CSS part 改名垫片：宿主的 ::part(submit-button) 无法匹配 v2 的 part=submit，
  //    shim 直接把宿主的样式意图以属性选择器注入组件 shadow root。
  //    若组件故障 strip-parts（part 属性被移除），选择器无目标：垫片在，但静默失效。
  const root = el.shadowRoot;
  if (root && !root.getElementById(SHIM_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = SHIM_STYLE_ID;
    style.textContent = `[part="${renames.parts['submit-button']}"]{background:#059669!important;border-radius:0!important;}`;
    root.appendChild(style);
    stats.styleShimInstalled = true;
  }

  return () => {
    el.removeEventListener('submit', onNewSubmit as EventListener);
    mo.disconnect();
    el.setAttribute = origSetAttribute;
    el.removeAttribute = origRemoveAttribute;
    root?.getElementById(SHIM_STYLE_ID)?.remove();
    delete el.__adapterStats;
  };
}

/** 读取元素所在文档里，::part 旧名选择器是否仍有定义（仅用于解释展示） */
export function hostStyleIntent(): string {
  return `@customElement host stylesheet → order-form::part(submit-button) { background: green; border-radius: 0 }`;
}
