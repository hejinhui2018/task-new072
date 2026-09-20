import type {
  CheckResult,
  Dimension,
  FaultSet,
  StepResult,
  Verdict,
  VersionId,
} from '../contract/types';
import { tagFor, upgradeLate, isLateUpgraded, LATE_TAGS } from '../contract/elements';
import { installAdapter } from '../contract/adapter';

export interface RunConfig {
  version: VersionId;
  compat: boolean;
  faults: FaultSet;
}

export interface StepMeta {
  title: string;
  dimension: Dimension | 'lifecycle';
  goal: string;
}

export const STEP_META: StepMeta[] = [
  {
    title: '内容投影：默认 slot 与具名 slot',
    dimension: 'slots',
    goal: '宿主按 v1 把按钮投射进 actions；v2 已改名 footer。验证 flattened slot tree 里的真实归属。',
  },
  {
    title: '属性反射：attribute ↔ property',
    dimension: 'attributes',
    goal: '写 property 看 attribute 是否回写；宿主 setAttribute 看组件是否观察。',
  },
  {
    title: '事件传播：提交能否到达宿主',
    dimension: 'events',
    goal: '点击 shadow 内部提交按钮，宿主仍按 v1 监听 form-submit。观察 retarget 与转译。',
  },
  {
    title: '样式暴露：::part 与 CSS 变量',
    dimension: 'parts',
    goal: "宿主样式表写的是 ::part(submit-button)；v2 的 part 叫 submit。读计算样式判定意图是否落地。",
  },
  {
    title: '生命周期：重挂载一致性',
    dimension: 'lifecycle',
    goal: '销毁后用同一配置重建并重放交互，验证 slot/事件/适配层在新实例上仍然成立。',
  },
  {
    title: '多实例隔离：实例级故障不串扰',
    dimension: 'lifecycle',
    goal: '同页挂两个实例，仅给 B 注入 drop-submit，验证 A 不受影响、状态不泄漏。',
  },
  {
    title: '升级边界：未注册标签的渐进升级',
    dimension: 'lifecycle',
    goal: '标签先于定义存在（HTML 解析期未升级），定义后验证 shadow root 生成、光域子节点保留且事件可用。',
  },
];

interface EventObs {
  name: string;
  pathTags: string;

  detail: string;
}

interface Instance {
  host: HTMLElement;
  ce: HTMLElement;
  disposeAdapter: () => void;
  events: EventObs[];
  id: string;
}

const HOST_STYLE = `
  .hostwrap { border: 1px solid #b7c2d0; border-radius: 12px; padding: 10px; background: #f1f5f9; }
  .host-chrome { font-size: 12px; color: #475569; margin-bottom: 8px; display:flex; gap:8px; align-items:center; }
  .host-chrome code { background:#e2e8f0; padding:1px 6px; border-radius:6px; }
  .light-child { padding: 4px 8px; font-size: 13px; }
  .host-action { margin: 6px 8px; font: inherit; padding: 3px 10px; border-radius: 6px;
    border: 1px solid #94a3b8; background: #fff; }
  /* 宿主（业务页面）的样式表：按 v1 契约编写，升级后不改 */
  order-form-v1::part(submit-button) { background: #16a34a; border-radius: 2px; }
  order-form-v2::part(submit-button) { background: #16a34a; border-radius: 2px; }
`;

let seq = 0;

function aggregate(checks: CheckResult[]): Verdict {
  const order: Verdict[] = ['fail', 'loss', 'adapted', 'info', 'pass'];
  for (const v of order) {
    if (checks.some((c) => c.verdict === v)) return v;
  }
  return 'pass';
}

function rgb(rgb255: string): string {
  return `rgb(${rgb255})`;
}

const GREEN_HOST = rgb('22, 163, 74');
const GREEN_SHIM = rgb('5, 150, 105');

export class StageRunner {
  private container: HTMLElement;
  private config: RunConfig;
  private main!: Instance;
  private extra: Instance[] = [];
  private ops: Array<() => void> = [];
  private lateHost: HTMLElement | null = null;

  constructor(container: HTMLElement, config: RunConfig) {
    this.container = container;
    this.config = config;
    this.mount();
  }

  getConfig(): RunConfig {
    return this.config;
  }

  setConfig(config: RunConfig): void {
    this.config = config;
    this.teardown();
    this.mount();
  }

  private teardown(): void {
    this.main?.disposeAdapter();
    this.extra.forEach((i) => i.disposeAdapter());
    this.extra = [];
    this.lateHost = null;
    this.ops = [];
    this.container.innerHTML = '';
  }

  destroy(): void {
    this.teardown();
  }

  // ---- 挂载 -----------------------------------------------------------------

  private buildInstance(id: string, version: VersionId, faults: FaultSet): Instance {
    const tag = tagFor(version);
    const host = document.createElement('div');
    host.className = 'hostwrap';
    const style = document.createElement('style');
    style.textContent = HOST_STYLE;
    host.appendChild(style);

    const chrome = document.createElement('div');
    chrome.className = 'host-chrome';
    chrome.innerHTML = `<span>宿主：业务订单页（按 <b>v1</b> 契约监听 / 投射 / 写样式）</span><code>&lt;${tag}&gt;</code><span>实例 ${id}</span>`;
    host.appendChild(chrome);

    const ce = document.createElement(tag) as HTMLElement;
    ce.__instanceId = id;
    ce.__faults = faults;
    ce.setAttribute('title', '订单 #2048');
    ce.setAttribute('size', 'large');

    const bodyChild = document.createElement('div');
    bodyChild.className = 'light-child';
    bodyChild.textContent = '【默认 slot】订单正文：机械键盘 ×1，宿主光域子节点';
    ce.appendChild(bodyChild);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'host-action';
    actionBtn.slot = 'actions'; // 宿主始终按 v1 旧名投射
    actionBtn.textContent = '宿主投射：去结算（slot=actions）';
    ce.appendChild(actionBtn);

    host.appendChild(ce);

    const inst: Instance = { host, ce, disposeAdapter: () => {}, events: [], id };
    const record = (name: string) => (ev: Event) => {
      const path = ev.composedPath();
      inst.events.push({
        name,
        pathTags: path
          .slice(0, 6)
          .map((n) => (n as Element).tagName ?? (n as ShadowRoot).host?.tagName ?? '#document')
          .filter(Boolean)
          .join(' → '),
        detail: JSON.stringify((ev as CustomEvent).detail ?? {}),
      });
    };
    host.addEventListener('form-submit', record('form-submit'));
    host.addEventListener('form-change', record('form-change'));
    host.addEventListener('submit', record('submit'));

    inst.disposeAdapter = this.config.compat
      ? installAdapter(ce, 'v1', version)
      : () => {};
    return inst;
  }

  private mount(): void {
    seq += 1;
    this.main = this.buildInstance(`A${seq}`, this.config.version, {});
    this.container.appendChild(this.main.host);
  }

  private remountFresh(): void {
    this.teardown();
    this.mount();
    const replay = this.ops.slice();
    this.ops = [];
    replay.forEach((op) => op());
  }

  private root(): ShadowRoot {
    return this.main.ce.shadowRoot!;
  }

  private submitButton(): HTMLButtonElement {
    return this.root().querySelector<HTMLButtonElement>('button.submit')!;
  }

  private slotStatus(): { name: string; assigned: number }[] {
    return Array.from(this.root().querySelectorAll('slot')).map((s) => ({
      name: s.name || '(默认)',
      assigned: s.assignedNodes().length,
    }));
  }

  // ---- 各步骤 ---------------------------------------------------------------

  runStep(index: number, restored = false): StepResult {
    const probe = [
      () => this.probeSlots(),
      () => this.probeReflection(),
      () => this.probeEvents(),
      () => this.probeParts(),
      () => this.probeRemount(),
      () => this.probeMultiInstance(),
      () => this.probeUpgrade(),
    ][index];
    const result = probe();
    return { ...result, index, restored, ts: Date.now() };
  }

  private base(
    title: string,
    dimension: StepMeta['dimension'],
    checks: CheckResult[],
    facts: Record<string, string>,
  ): Omit<StepResult, 'index' | 'restored' | 'ts'> {
    return { title, dimension, verdict: aggregate(checks), checks, facts };
  }

  private probeSlots() {
    const checks: CheckResult[] = [];
    const slots = this.slotStatus();
    const def = slots.find((s) => s.name === '(默认)');
    const named = slots.filter((s) => s.name !== '(默认)');
    const lightAction = this.main.ce.querySelector<HTMLButtonElement>('.host-action')!;
    const projectedSlot = lightAction.getAttribute('slot');
    const namedAssigned = named.reduce((n, s) => n + s.assigned, 0);
    const swallowed = !!this.config.faults['swallow-slots'];

    checks.push({
      name: '默认 slot 投影',
      verdict: (def?.assigned ?? 0) >= 1 ? 'pass' : 'loss',
      expected: '订单正文作为光域子节点出现在 flattened tree',
      actual: `默认 slot assignedNodes = ${def?.assigned ?? 0}`,
      detail:
        (def?.assigned ?? 0) >= 1
          ? '正文节点由宿主光域投射，组件只声明 <slot>，不复制节点——这是内容投影而非 innerHTML 注入。'
          : '正文未进入任何 slot，发生静默丢失。',
    });

    if (this.config.version === 'v1') {
      checks.push({
        name: '具名 slot actions（v1）',
        verdict: namedAssigned >= 1 ? 'pass' : 'loss',
        expected: 'slot=actions 的按钮被 actions 槽接收',
        actual: `宿主按钮 slot="${projectedSlot}"，组件 actions 槽 assigned = ${namedAssigned}`,
        detail:
          namedAssigned >= 1
            ? '同名匹配，投影成立。'
            : '具名槽无人接收，按钮不渲染。',
      });
    } else if (!this.config.compat) {
      checks.push({
        name: '具名 slot 改名（v2，无适配）',
        verdict: 'loss',
        expected: '宿主仍投射 slot=actions；v2 只声明 footer',
        actual: `宿主按钮 slot="${projectedSlot}"，footer 槽 assigned = ${namedAssigned}；按钮在 flattened tree 中不可见`,
        detail:
          '名字不匹配且没有任何报错——按钮被静默丢弃。组件“看起来正常渲染”，但宿主内容缺失。这是典型的静默丢失，不是兼容适配。',
      });
    } else if (swallowed) {
      checks.push({
        name: '适配已改名，但组件不声明槽位',
        verdict: 'loss',
        expected: '适配层把 actions 改写为 footer，等待组件 footer 槽',
        actual: `宿主按钮已被改写为 slot="${projectedSlot}"，但组件模板中没有 footer 槽（swallow-slots 故障），assigned = ${namedAssigned}`,
        detail:
          '适配层做对了它那一侧，组件却未声明槽位，投影仍然静默丢失。宿主侧适配无法替代组件内部的 <slot> 声明。',
      });
    } else {
      checks.push({
        name: '具名 slot 改名（v2 + 适配层）',
        verdict: 'adapted',
        expected: '适配层把宿主的 slot=actions 改写为 v2 的 footer',
        actual: `宿主按钮实际挂到 slot="${projectedSlot}"，footer 槽 assigned = ${namedAssigned}`,
        detail:
          '组件接收的是 footer、宿主写的是 actions，适配层在光域改写 slot 属性完成桥接。属于兼容适配：宿主源码未改，但契约名仍不一致，升级适配层下线时会重新丢失。',
      });
    }

    return this.base(STEP_META[0].title, 'slots', checks, {
      '组件声明的 slot': slots.map((s) => `${s.name}(${s.assigned})`).join(', ') || '无（模板未声明 slot）',
      '宿主投射的 slot 属性': `默认 + slot="${lightAction.slot}"`,
      '组件版本': this.config.version,
      '适配层': this.config.compat ? '已安装' : '未安装',
    });
  }

  private probeReflection() {
    const checks: CheckResult[] = [];
    const ce = this.main.ce;
    const reflectBlocked = !!this.config.faults['block-reflection'];
    const observed: string[] = (ce.constructor as unknown as { observedAttributes: string[] })
      .observedAttributes ?? [];

    // title：property -> attribute
    ce.title = '反射探测标题';
    const titleAttr = ce.getAttribute('title');
    checks.push({
      name: 'title property 反射到 attribute',
      verdict: titleAttr === '反射探测标题' ? 'pass' : reflectBlocked ? 'fail' : 'loss',
      expected: 'el.title = x 后 getAttribute("title") === x',
      actual: `attribute = ${JSON.stringify(titleAttr)}`,
      detail:
        titleAttr === '反射探测标题'
          ? 'property setter 内部调用 setAttribute，宿主的 [title] 属性选择器与序列化 HTML 都能看到。'
          : reflectBlocked
            ? '故障 block-reflection 切断了 setter 的回写：赋值不报错，DOM 却不变——静默丢失，宿主侧适配层无法感知 property 写入。'
            : 'property 写入未反射。',
    });

    // size：两版本差异点
    const sizeObserved = observed.includes('size');
    (ce as unknown as { size: string }).size = 'small';
    const sizeAttrAfterProp = ce.getAttribute('size');
    if (this.config.version === 'v1') {
      checks.push({
        name: 'size 双向绑定（v1）',
        verdict: sizeAttrAfterProp === 'small' && sizeObserved ? 'pass' : 'loss',
        expected: 'v1: size property 反射、attribute 被观察',
        actual: `observedAttributes 含 size = ${sizeObserved}；写 property 后 attribute = ${JSON.stringify(sizeAttrAfterProp)}`,
        detail: sizeObserved && sizeAttrAfterProp === 'small'
          ? 'attribute 是单一事实源，宿主用 setAttribute/[size] 选择器都成立。'
          : '反射链断裂。',
      });
    } else if (!this.config.compat) {
      checks.push({
        name: 'size 改为 property-only（v2，无适配）',
        verdict: 'loss',
        expected: 'v1 页面用 setAttribute("size","large") 与 [size] 样式钩子',
        actual: `observedAttributes 含 size = ${sizeObserved}；写 property 后 attribute = ${JSON.stringify(sizeAttrAfterProp)}（仍为初始 large）`,
        detail:
          'v2 不再观察 size attribute、property 也不回写：宿主的配置能进 DOM 却不驱动组件，[size] 样式钩子同时失效。无异常抛出，属于静默的契约收窄。',
      });
    } else {
      // 适配层：初始 size attribute 已转发，且后续宿主写 attribute 会被转发成 property
      ce.setAttribute('size', 'mini');
      const propValue = (ce as unknown as { size: string }).size;
      checks.push({
        name: 'size attribute→property 转发（v2 + 适配层）',
        verdict: propValue === 'mini' ? 'adapted' : 'loss',
        expected: '适配层监听 size attribute，转发写入 component.size',
        actual: `转发后 property = ${JSON.stringify(propValue)}；但 property→attribute 仍不反射，attribute 面板读到 ${JSON.stringify(
          ce.getAttribute('size'),
        )}`,
        detail:
          propValue === 'mini'
            ? '宿主的 setAttribute 能驱动组件（半条链被适配层补上）；但 property 写不回 attribute，依赖反射的 [size] CSS 钩子和 HTML 序列化仍旧丢失。适配是单向的，需在验收结论中显式登记。'
            : '适配层转发未生效。',
      });
    }

    // disabled：attribute -> property（两版本都保留）
    ce.setAttribute('disabled', '');
    const disabledProp = (ce as unknown as { disabled: boolean }).disabled;
    checks.push({
      name: 'disabled attribute→property（共有契约）',
      verdict: disabledProp === true ? 'pass' : 'fail',
      expected: 'setAttribute("disabled") 后 el.disabled === true',
      actual: `el.disabled = ${disabledProp}`,
      detail: disabledProp ? '布尔属性语义两版本一致。' : '共有契约被破坏。',
    });
    ce.removeAttribute('disabled');

    this.ops.push(() => {
      (this.main.ce as unknown as { title: string }).title = '反射探测标题';
      (this.main.ce as unknown as { size: string }).size = 'small';
    });

    return this.base(STEP_META[1].title, 'attributes', checks, {
      observedAttributes: observed.join(', ') || '（无）',
      'title attribute': JSON.stringify(ce.getAttribute('title')),
      'size attribute': JSON.stringify(ce.getAttribute('size')),
      'size property': JSON.stringify((ce as unknown as { size: string }).size),
    });
  }

  private probeEvents() {
    const checks: CheckResult[] = [];
    this.main.events = [];
    this.submitButton().click();
    const got = (n: string) => this.main.events.filter((e) => e.name === n);
    const dropped = !!this.config.faults['drop-submit'];
    const nonComposed = !!this.config.faults['force-non-composed'];
    const hostSubmit = got('form-submit').length;

    // 对照组：form-change 两版本同名
    this.root().querySelector<HTMLButtonElement>('button.qty')!.click();
    const changeOk = got('form-change').length === 1;

    if (dropped) {
      checks.push({
        name: '提交事件被组件丢弃',
        verdict: 'fail',
        expected: '点击提交后宿主收到 form-submit（v1 契约）',
        actual: `组件内部点击发生，host 收到 form-submit × ${hostSubmit}、submit × ${got('submit').length}`,
        detail:
          'drop-submit 故障下组件渲染、悬停全部正常，唯独不派发事件。宿主侧适配层监听的是宿主节点，组件不发就没有任何东西可转译——适配无法凭空制造事件，必须修组件。',
      });
    } else if (nonComposed) {
      checks.push({
        name: '事件不穿越 shadow 边界',
        verdict: 'fail',
        expected: 'composed 事件 retarget 到宿主节点',
        actual: `host 收到 form-submit × ${hostSubmit}、submit × ${got('submit').length}（事件 composed=false，止步于 shadow root）`,
        detail:
          'v2 的提交事件被降级为非 composed：它只在 shadow root 内传播，光域的宿主监听永远收不到。适配层同样挂在光域，无法订阅边界内部事件——这是组件必须修复的传播契约，不能靠宿主垫片掩盖。',
      });
    } else if (this.config.version === 'v1') {
      checks.push({
        name: 'form-submit 直达宿主（v1）',
        verdict: hostSubmit >= 1 ? 'pass' : 'fail',
        expected: '组件派发 form-submit，bubbles+composed，宿主监听同名事件',
        actual: `host 收到 form-submit × ${hostSubmit}；composedPath：${got('form-submit')[0]?.pathTags ?? '—'}`,
        detail: '同名 + composed，事件经 retarget 后以组件为目标到达宿主，业务回调直接执行。',
      });
    } else if (!this.config.compat) {
      checks.push({
        name: '事件改名，宿主监听器静默失效（v2，无适配）',
        verdict: 'loss',
        expected: '宿主监听 form-submit；v2 派发的是 submit',
        actual: `host 收到 form-submit × ${hostSubmit}，submit × ${got('submit').length}（裸事件到达但无业务监听者）`,
        detail:
          '这就是“提交按钮的事件没有到达宿主”的真实形态：事件确实穿越了 shadow 边界，却因改名没有任何业务代码消费——不报错、不崩溃、回调静默不执行。属于静默丢失。',
      });
    } else {
      const translated = (this.main.ce.__adapterStats?.eventsTranslated ?? 0) > 0;
      checks.push({
        name: 'submit → form-submit 转译（v2 + 适配层）',
        verdict: hostSubmit >= 1 ? 'adapted' : 'fail',
        expected: '适配层在宿主节点监听新名 submit，再派发旧名 form-submit',
        actual: `host 收到 form-submit × ${hostSubmit}；适配层转译计数 = ${this.main.ce.__adapterStats?.eventsTranslated ?? 0}`,
        detail: translated
          ? '业务页面的 form-submit 回调照常执行，但组件原生事件名已经是 submit：宿主依赖的是适配层合成的旧事件，detail 被原样转发。属于兼容适配，应登记技术债并推动业务侧改名。'
          : '适配层未完成转译。',
      });
    }

    checks.push({
      name: '对照组：form-change 两版本同名',
      verdict: changeOk ? 'pass' : 'fail',
      expected: '数量变更事件名未改，始终可达',
      actual: `host 收到 form-change × ${got('form-change').length}`,
      detail: changeOk
        ? '同名事件无需适配即到达，印证问题精确出在改名的 submit 契约，而非 shadow DOM 本身。'
        : '连未改名事件都不可达，说明传播链路整体异常。',
    });

    return this.base(STEP_META[2].title, 'events', checks, {
      '宿主监听': 'form-submit（v1 业务回调）',
      'form-submit 到达次数': String(hostSubmit),
      'submit 裸事件到达次数': String(got('submit').length),
      'form-change 到达次数': String(got('form-change').length),
      '最近事件 detail': this.main.events.at(-1)?.detail ?? '—',
      '事件路径': this.main.events.at(-1)?.pathTags ?? '—',
    });
  }

  private probeParts() {
    const checks: CheckResult[] = [];
    const root = this.root();
    const btn = this.submitButton();
    const bg = getComputedStyle(btn).backgroundColor;
    const green = bg === GREEN_HOST || bg === GREEN_SHIM;
    const stripped = !!this.config.faults['strip-parts'];
    const oldPart = root.querySelector('[part="submit-button"]');
    const newPart = root.querySelector('[part="submit"]');
    const shim = !!root.getElementById('host-compat-shim');

    if (stripped) {
      checks.push({
        name: 'part 属性被组件移除',
        verdict: 'fail',
        expected: '提交按钮暴露 part（submit-button 或 submit）',
        actual: `shadow 内 [part=submit-button] = ${oldPart ? 1 : 0}，[part=submit] = ${
          newPart ? 1 : 0
        }；计算背景 = ${bg}`,
        detail:
          '::part 的前提是组件显式暴露 part。part 被剥离后，外部样式完全无法触及内部按钮——这不是名字问题，是样式暴露面被关闭。',
      });
      if (shim) {
        checks.push({
          name: '适配垫片存在但无目标',
          verdict: 'fail',
          expected: '垫片规则 [part=submit] 命中按钮',
          actual: `shadow root 中垫片样式已安装 = ${shim}，但选择器匹配 0 个节点，背景仍为 ${bg}`,
          detail:
            '适配层“运行正常”却静默失效：它无法给没有 part 的节点补出 part（穿透 shadow 改内部 DOM 已超出宿主契约）。验收必须把“垫片已装”与“垫片生效”分开记录。',
        });
      }
    } else if (this.config.version === 'v1') {
      checks.push({
        name: '::part(submit-button) 命中（v1）',
        verdict: green ? 'pass' : 'fail',
        expected: '宿主绿色意图落到提交按钮',
        actual: `计算背景 = ${bg}，期望 ${GREEN_HOST}`,
        detail: 'part 名一致，宿主样式表经 ::part 穿透 shadow 边界生效。',
      });
    } else if (!this.config.compat) {
      checks.push({
        name: 'part 改名导致样式静默失效（v2，无适配）',
        verdict: 'loss',
        expected: '::part(submit-button) 变绿',
        actual: `组件暴露的是 part=submit；旧选择器匹配 0；计算背景 = ${bg}（组件默认靛蓝）`,
        detail:
          'CSS 选择器不匹配时不报错也不告警，宿主样式表整条规则被静默跳过：视觉上按钮“样式回退”，业务却以为自己的设计令牌生效了。属于静默丢失。',
      });
    } else {
      checks.push({
        name: 'part 改名垫片（v2 + 适配层）',
        verdict: green ? 'adapted' : 'loss',
        expected: '适配层向 shadow root 注入 [part=submit] 的等价规则',
        actual: `计算背景 = ${bg}（垫片绿 ${GREEN_SHIM}）；原生 ::part(submit-button) 仍匹配 0`,
        detail:
          '颜色对了，但路径是适配层向组件 shadow root 内部注入样式，而非宿主样式表通过标准 ::part 生效。这是兼容适配：它需要对每个实例、每次重挂载重复安装，且无法覆盖被剥离 part 的组件。',
      });
    }

    return this.base(STEP_META[3].title, 'parts', checks, {
      '[part=submit-button] 节点数': String(oldPart ? 1 : 0),
      '[part=submit] 节点数': String(newPart ? 1 : 0),
      '适配垫片已安装': String(shim),
      '提交按钮计算背景': bg,
      'CSS 变量 --brand': getComputedStyle(this.main.ce).getPropertyValue('--brand') || '未定义（回退 #4f46e5）',
    });
  }

  private probeRemount() {
    const beforeId = this.main.id;
    const beforeRoot = this.root();
    this.remountFresh();
    const afterId = this.main.id;
    const afterRoot = this.root();
    const slots = this.slotStatus();
    this.main.events = [];
    this.submitButton().click();
    const reached = this.main.events.some((e) => e.name === 'form-submit');
    const rawSubmit = this.main.events.some((e) => e.name === 'submit');
    const dropped = !!this.config.faults['drop-submit'] || !!this.config.faults['force-non-composed'];

    const expectedReach =
      this.config.version === 'v1' || this.config.compat ? !dropped : false;
    const ok = beforeId !== afterId && beforeRoot !== afterRoot && reached === expectedReach;

    const checks: CheckResult[] = [
      {
        name: '重建产生全新实例与 shadow root',
        verdict: beforeId !== afterId && beforeRoot !== afterRoot ? 'pass' : 'fail',
        expected: '旧实例销毁，新实例、新 shadow root',
        actual: `${beforeId} → ${afterId}；shadow root ${beforeRoot === afterRoot ? '同一个' : '已重建'}`,
        detail: '自定义元素的内部状态不随容器复用而残留，验证的是真正的卸载/挂载而非 display 切换。',
      },
      {
        name: '重放交互后契约表现一致',
        verdict: reached === expectedReach ? 'pass' : 'fail',
        expected: `form-submit ${expectedReach ? '到达' : '不到达（与当前故障/适配配置一致）'}`,
        actual: `form-submit × ${reached ? 1 : 0}，裸 submit × ${rawSubmit ? 1 : 0}；slot 状态：${slots
          .map((s) => `${s.name}=${s.assigned}`)
          .join(', ')}`,
        detail: ok
          ? '初始 attributes、光域子节点、适配层、事件监听在重挂载后按同一配置复现，验收结果可重复。'
          : '重挂载后行为与首次不一致，适配层可能遗漏了卸载重装。',
      },
    ];

    return this.base(STEP_META[4].title, 'lifecycle', checks, {
      '旧实例': beforeId,
      '新实例': afterId,
      '适配层随重挂载重装': String(this.config.compat),
      '重放操作数': String(this.ops.length),
    });
  }

  private probeMultiInstance() {
    const checks: CheckResult[] = [];
    // 重复执行本步骤前先拆除上一轮的实例 B，避免探针 DOM 堆积
    this.extra.forEach((i) => {
      i.disposeAdapter();
      i.host.remove();
    });
    this.extra = [];
    seq += 1;
    const b = this.buildInstance(`B${seq}`, this.config.version, { 'drop-submit': true });
    this.extra.push(b);
    this.container.appendChild(b.host);

    // 状态隔离：不同标题
    (b.ce as unknown as { title: string }).title = '实例 B 的标题';
    const aTitle = (this.main.ce as unknown as { title: string }).title;
    const bTitle = (b.ce as unknown as { title: string }).title;

    this.main.events = [];
    b.events = [];
    this.submitButton().click();
    b.ce.shadowRoot!.querySelector<HTMLButtonElement>('button.submit')!.click();

    const aReach = this.main.events.some((e) => e.name === 'form-submit');
    const bReach = b.events.some((e) => e.name === 'form-submit');
    const bRaw = b.events.some((e) => e.name === 'submit');
    const crossTalk =
      this.main.events.some((e) => e.detail.includes(b.id)) ||
      b.events.some((e) => e.detail.includes(this.main.id));
    const isolated = aTitle !== bTitle && !crossTalk;
    // A 没有实例级故障，它应严格跟随「版本 + 适配 + 全局故障」给出的结果；
    // B 额外叠加实例级 drop-submit。隔离要验证的是 B 的覆盖不外溢、A 只受全局影响。
    const globalBlocksSubmit =
      !!this.config.faults['drop-submit'] || !!this.config.faults['force-non-composed'];
    const aExpected = (this.config.version === 'v1' || this.config.compat) && !globalBlocksSubmit;

    checks.push({
      name: '实例 B 的故障被限制在 B',
      verdict: !bReach && !bRaw && aReach === aExpected ? 'pass' : 'fail',
      expected: `B 必收不到（实例级 drop-submit）；A ${aExpected ? '应收到（跟随全局配置）' : '也收不到（全局开关本就拦截）'}`,
      actual: `A form-submit × ${aReach ? 1 : 0}；B form-submit × ${bReach ? 1 : 0}、裸 submit × ${bRaw ? 1 : 0}`,
      detail: !bReach && !bRaw && aReach === aExpected
        ? 'B 的实例级故障没有外溢到 A：A 的表现只由版本/适配/全局开关决定，证明契约校验必须按实例叠加配置而非按标签名一刀切。'
        : '出现跨实例串扰，或 A 未按全局配置表现，隔离失败。',
    });
    checks.push({
      name: '光/影状态互不泄漏',
      verdict: isolated ? 'pass' : 'fail',
      expected: 'A、B 各自 shadow root、title、事件日志独立',
      actual: `A.title=${JSON.stringify(aTitle)}；B.title=${JSON.stringify(bTitle)}；跨实例事件串扰 = ${crossTalk}`,
      detail: isolated
        ? '两个实例拥有独立 shadow root 与适配统计；全局故障开关仍共享，实例级覆盖只影响自身。'
        : '检测到属性或事件跨实例泄漏。',
    });

    return this.base(STEP_META[5].title, 'lifecycle', checks, {
      'A 实例故障': '无（仅全局开关）',
      'B 实例故障': 'drop-submit',
      'A 事件日志': this.main.events.map((e) => e.name).join(', ') || '空',
      'B 事件日志': b.events.map((e) => e.name).join(', ') || '空',
    });
  }

  private probeUpgrade() {
    const checks: CheckResult[] = [];
    const { version, compat } = this.config;
    // 升级标签每个版本全局只注册一次；重复执行本步骤时移除上一轮探针 DOM
    this.lateHost?.remove();
    // 升级前：标签未注册（该版本首次执行本步骤时）
    const late = document.createElement(LATE_TAGS[version]) as HTMLElement;
    late.setAttribute('title', '延迟升级订单');
    const child = document.createElement('div');
    child.className = 'light-child';
    child.textContent = '【升级前就存在的光域子节点】';
    late.appendChild(child);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'host-action';
    btn.slot = 'actions';
    btn.textContent = '升级前投射的 actions 按钮';
    late.appendChild(btn);

    const preConstructor = late.constructor === HTMLElement ? 'HTMLElement（未升级）' : late.constructor.name;
    const preShadow = late.shadowRoot ? '已存在' : 'null';
    const preChildren = late.children.length;

    const wrap = document.createElement('div');
    wrap.className = 'hostwrap';
    const label = document.createElement('div');
    label.className = 'host-chrome';
    label.textContent = '升级边界探针：标签先于 customElements.define 存在';
    wrap.appendChild(label);
    wrap.appendChild(late);
    this.lateHost = wrap;
    this.container.appendChild(wrap);

    let dispose = compat && version === 'v2' ? installAdapter(late, 'v1', 'v2') : () => {};
    const wasUpgraded = isLateUpgraded(version);
    upgradeLate(version);
    if (compat && version === 'v2') {
      dispose();
      dispose = installAdapter(late, 'v1', 'v2'); // 升级后重装：拿到新 shadow root 注入垫片
    }

    const postShadow = late.shadowRoot ? 'open shadow root' : '仍为 null';
    const retained = late.querySelectorAll('.light-child,.host-action').length;
    const namedSlot = late.shadowRoot?.querySelector<HTMLSlotElement>('slot[name]');
    const assigned = namedSlot?.assignedNodes().length ?? 0;

    // 升级后事件
    const events: string[] = [];
    const record = (n: string) => () => events.push(n);
    wrap.addEventListener('form-submit', record('form-submit'));
    wrap.addEventListener('submit', record('submit'));
    late.shadowRoot?.querySelector<HTMLButtonElement>('button.submit')?.click();
    const expectsLegacy = version === 'v1' || compat;
    const eventOk = events.includes(expectsLegacy ? 'form-submit' : 'submit');
    const eventBroken = !!this.config.faults['drop-submit'] || !!this.config.faults['force-non-composed'];

    checks.push({
      name: '升级前状态可识别',
      verdict: !wasUpgraded ? 'pass' : 'info',
      expected: '未注册标签是普通 HTMLElement，无 shadow root、无生命周期',
      actual: `constructor = ${preConstructor}；shadowRoot = ${preShadow}；光域子节点 ${preChildren} 个`,
      detail: !wasUpgraded
        ? 'HTML 解析期组件库尚未加载时，宿主子节点只是普通元素，浏览器照常保留它们——这是渐进升级的基础。'
        : '本轮不是首次升级（类已注册），展示幂等路径。',
    });
    checks.push({
      name: '升级后 shadow root 生成且子节点保留',
      verdict: late.shadowRoot && retained === 2 ? 'pass' : 'fail',
      expected: 'define 触发升级：构造函数运行，已有光域节点不被清空或复制',
      actual: `${postShadow}；保留光域节点 ${retained}/2`,
      detail:
        retained === 2
          ? '升级只补上 shadow root 与生命周期，宿主光域子节点原样保留，不被清空也不被组件复制。'
          : '升级清空或重复了宿主子节点，升级边界不安全。',
    });
    const slotVerdict: Verdict =
      version === 'v1' ? 'pass' : compat ? (assigned >= 1 ? 'adapted' : 'loss') : 'loss';
    const slotExpected =
      version === 'v1'
        ? 'v1 组件声明 actions 槽，升级瞬间按钮直接归入'
        : compat
          ? '适配层已在升级前把 actions 改写为 footer，槽位生成时即归入'
          : '无适配：按钮仍是 slot=actions，v2 的 footer 槽不会接收它';
    checks.push({
      name: '升级瞬间槽位的延迟解析',
      verdict: slotVerdict,
      expected: slotExpected,
      actual: `${namedSlot?.name ?? '无具名槽'} 槽 assigned = ${assigned}；宿主按钮 slot="${btn.getAttribute('slot')}"`,
      detail:
        assigned >= 1
          ? 'slot 投影是延迟解析的：升级前投射的按钮在 shadow root 生成的同一时刻被归入槽位，宿主无需重渲染。'
          : 'shadow root 生成了，但旧 slot 名没有接收方——升级成功而投影静默丢失，与步骤 1 结论一致。',
    });
    checks.push({
      name: '升级后事件契约立即可用',
      verdict: eventBroken ? 'fail' : eventOk ? 'pass' : 'fail',
      expected: `${expectsLegacy ? 'form-submit' : '原生 submit'} 到达 wrap`,
      actual: `wrap 收到：${events.join(', ') || '无'}`,
      detail: eventBroken
        ? '升级本身成功，但事件故障依旧——升级边界正确不等于契约正确，两类问题必须分开判。'
        : eventOk
          ? '升级完成的同一 tick 内事件链路即按当前版本/适配配置工作。'
          : '升级后事件未达宿主。',
    });
    if (compat && version === 'v2') {
      checks.push({
        name: '适配层必须在升级后重装',
        verdict: late.shadowRoot?.getElementById('host-compat-shim') ? 'adapted' : 'loss',
        expected: '升级前没有 shadow root 可注入垫片；升级后重新安装',
        actual: `垫片存在 = ${!!late.shadowRoot?.getElementById('host-compat-shim')}`,
        detail:
          '适配器若只在节点未升级时安装一次，part 垫片会静默缺失（监听器仍有效）。这是升级场景特有的适配顺序约束。',
      });
    }

    return this.base(STEP_META[6].title, 'lifecycle', checks, {
      '升级前 constructor': preConstructor,
      '升级前 shadowRoot': preShadow,
      '升级后 shadowRoot': postShadow,
      '光域子节点保留': `${retained}/2`,
      '升级后 wrap 收到事件': events.join(', ') || '无',
      '升级方式': 'customElements.define 触发的同步升级',
    });
  }
}
