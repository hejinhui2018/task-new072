import type { FaultSet, VersionId } from './types';

interface ElementConfig {
  version: VersionId;
  actionSlot: string; // v1: actions, v2: footer
  submitEvent: string; // v1: form-submit, v2: submit
  submitPart: string; // v1: submit-button, v2: submit
  reflectSize: boolean; // v1 的 size 反射，v2 改为 property-only
  versionLabel: string;
}

const CONFIGS: Record<VersionId, ElementConfig> = {
  v1: {
    version: 'v1',
    actionSlot: 'actions',
    submitEvent: 'form-submit',
    submitPart: 'submit-button',
    reflectSize: true,
    versionLabel: '1.4.0',
  },
  v2: {
    version: 'v2',
    actionSlot: 'footer',
    submitEvent: 'submit',
    submitPart: 'submit',
    reflectSize: false,
    versionLabel: '2.0.0',
  },
};

/** 全局故障开关（UI 勾选），所有实例共享 */
const globalFaults: FaultSet = {};

export function setGlobalFaults(faults: FaultSet): void {
  for (const key of Object.keys(globalFaults) as (keyof FaultSet)[]) {
    delete globalFaults[key];
  }
  Object.assign(globalFaults, faults);
}

export function getGlobalFaults(): FaultSet {
  return { ...globalFaults };
}

declare global {
  interface HTMLElement {
    /** 每实例故障覆盖（多实例隔离测试用） */
    __faults?: FaultSet;
    __instanceId?: string;
  }
}

function faultsOf(el: HTMLElement): FaultSet {
  return { ...globalFaults, ...(el.__faults ?? {}) };
}

const BASE_CSS = `
:host { display: block; border: 1px solid var(--card-border, #d8dee9); border-radius: 10px;
  background: var(--card-bg, #fff); color: #1f2933; font: 14px/1.5 system-ui, sans-serif; }
section { padding: 12px 14px; }
header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ver { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eef2ff; color: #4338ca; }
h4 { margin: 0; font-size: 15px; }
.hint { margin: 0 0 8px; font-size: 11px; color: #8290a0; }
.body { padding: 8px; border: 1px dashed #c7d0dd; border-radius: 8px; background: #f8fafc; }
.foot { margin-top: 8px; padding: 8px; border: 1px dashed #c7d0dd; border-radius: 8px; background: #f8fafc; }
.fallback { color: #9aa5b4; font-size: 12px; }
.btns { display: flex; gap: 8px; margin-top: 10px; }
button { font: inherit; padding: 5px 14px; border-radius: 8px; cursor: pointer; }
.qty { background: #fff; border: 1px solid #c7d0dd; }
.submit { background: var(--brand, #4f46e5); color: #fff; border: none; }
:host([disabled]) .submit { opacity: .45; cursor: not-allowed; }
`;

function createOrderFormClass(cfg: ElementConfig) {
  return class OrderFormElement extends HTMLElement {
    static get observedAttributes(): string[] {
      const base = ['title', 'disabled'];
      return cfg.reflectSize ? [...base, 'size'] : base;
    }

    #qty = 1;
    #rendered = false;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${BASE_CSS}</style>`;
      this.#render();
    }

    get version(): string {
      return cfg.versionLabel;
    }

    get title(): string {
      return this.getAttribute('title') ?? '';
    }
    set title(v: string) {
      this.#setReflectAttr('title', v === '' ? null : v);
    }

    get disabled(): boolean {
      return this.hasAttribute('disabled');
    }
    set disabled(v: boolean) {
      this.#setReflectAttr('disabled', v ? '' : null);
    }

    get size(): string | null {
      // v2：property 优先；未写过时回退读到外部直接设置的 attribute
      return this.#sizeValue ?? this.getAttribute('size');
    }
    set size(v: string | null) {
      // v2 契约：size 是 property-only，写入不反射；故障 block-reflection 连 v1 反射也切断
      this.#sizeValue = v;
      if (cfg.reflectSize && !faultsOf(this)['block-reflection']) {
        this.setAttribute('size', String(v));
      }
    }
    #sizeValue: string | null = null;

    get loading(): boolean {
      return this.#loading;
    }
    set loading(v: boolean) {
      this.#loading = v;
      this.classList.toggle('is-loading', v);
    }
    #loading = false;

    get readOnly(): boolean {
      return this.#readOnly;
    }
    set readOnly(v: boolean) {
      this.#readOnly = v;
    }
    #readOnly = false;

    #setReflectAttr(name: string, value: string | null): void {
      if (faultsOf(this)['block-reflection']) return; // 故障：property 写回被静默丢弃
      if (value === null) this.removeAttribute(name);
      else this.setAttribute(name, value);
    }

    attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
      if (!this.#rendered) return;
      if (name === 'title') {
        const el = this.shadowRoot?.querySelector('h4');
        if (el) el.textContent = next ?? '';
      }
      if (name === 'size') {
        this.#sizeValue = next;
      }
    }

    connectedCallback(): void {
      this.#render();
    }

    #render(): void {
      if (this.#rendered) return;
      this.#rendered = true;
      const root = this.shadowRoot!;
      const f = faultsOf(this);
      const stripParts = !!f['strip-parts'];
      const partAttr = (name: string) => (stripParts ? '' : `part="${name}"`);

      // swallow-slots：组件模板里根本不渲染具名 slot，宿主投射进来的节点无处可去
      const namedSlot = f['swallow-slots']
        ? `<div class="fallback">（组件内部已渲染自有操作区，未声明 ${cfg.actionSlot} slot）</div>`
        : `<slot name="${cfg.actionSlot}"><span class="fallback">（${cfg.actionSlot} slot 的回退内容：无投影时显示）</span></slot>`;

      const section = document.createElement('section');
      section.innerHTML = `
        <header>
          <span class="ver">${cfg.versionLabel}</span>
          <h4 ${partAttr('title')}>${this.title ?? '未命名订单'}</h4>
        </header>
        <p class="hint">open Shadow Root · 实例 ${this.__instanceId ?? '?'}</p>
        <div class="body" ${partAttr('panel')}><slot><span class="fallback">（默认 slot 回退）</span></slot></div>
        <div class="foot">${namedSlot}</div>
        <div class="btns">
          <button class="qty" type="button">数量 +1</button>
          <button class="submit" type="button" ${partAttr(cfg.submitPart)}>提交订单</button>
        </div>`;
      root.appendChild(section);

      section.querySelector<HTMLButtonElement>('.qty')!.addEventListener('click', () => {
        this.#qty += 1;
        this.dispatchEvent(
          new CustomEvent('form-change', {
            bubbles: true,
            composed: true,
            detail: { qty: this.#qty },
          }),
        );
      });

      section.querySelector<HTMLButtonElement>('.submit')!.addEventListener('click', () => {
        // 故障在派发瞬间读取：实例级 __faults 可能晚于构造函数（createElement）才赋上
        const live = faultsOf(this);
        if (live['drop-submit']) return; // 故障：提交事件被静默丢弃（渲染一切正常）
        this.dispatchEvent(
          new CustomEvent(cfg.submitEvent, {
            bubbles: true,
            composed: !live['force-non-composed'], // 故障：不穿越 shadow 边界
            detail: { orderId: 'ORD-2048', qty: this.#qty, by: this.__instanceId ?? '?' },
          }),
        );
      });
    }
  };
}

const lateUpgraded: Record<VersionId, boolean> = { v1: false, v2: false };

export function defineElements(): void {
  if (!customElements.get('order-form-v1')) {
    customElements.define('order-form-v1', createOrderFormClass(CONFIGS.v1));
  }
  if (!customElements.get('order-form-v2')) {
    customElements.define('order-form-v2', createOrderFormClass(CONFIGS.v2));
  }
}

/** 延迟升级标签：首次只声明标签，upgradeLate() 调用后才注册类（每个版本独立） */
export const LATE_TAGS: Record<VersionId, string> = {
  v1: 'order-form-late-v1',
  v2: 'order-form-late-v2',
};

export function isLateUpgraded(version: VersionId): boolean {
  return lateUpgraded[version];
}

export function upgradeLate(version: VersionId): void {
  if (lateUpgraded[version]) return;
  lateUpgraded[version] = true;
  customElements.define(LATE_TAGS[version], createOrderFormClass(CONFIGS[version]));
}

export function tagFor(version: VersionId): string {
  return version === 'v1' ? 'order-form-v1' : 'order-form-v2';
}
