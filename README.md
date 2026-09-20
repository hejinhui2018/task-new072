# SlotContract · Web Components 集成契约验收台

设计系统把一批旧组件升级成 Web Components 后，业务页面仍依赖旧的 slot 名、事件名和 CSS parts。
组件「看起来能渲染」，提交按钮的事件却没有到达宿主。本项目是一个从零搭建的**集成契约验收台**：
在真实的 open Shadow DOM 上挂载组件、执行交互流程，把升级差异明确区分为

- **通过 (pass)**：契约一致，宿主代码原样工作；
- **兼容适配 (adapted)**：差异被宿主适配层弥合，行为可用但依赖垫片，需登记技术债；
- **静默丢失 (loss)**：没有报错、没有告警，但宿主契约落空（改名 / 不反射 / 选择器落空）；
- **故障 (fail)**：组件侧破坏了传播 / 暴露契约，宿主适配**无法**补救。

技术栈：React 18 + TypeScript（strict）+ Vite 5，无 UI 组件库。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit + vite build
npm run preview
```

## 场景中的两个版本

宿主（业务订单页）的样式表、事件监听、slot 投射**始终按 v1 契约编写且不改动**：

| 契约面 | v1（旧） | v2（新） |
| --- | --- | --- |
| 具名 slot | `actions` | `footer` |
| 提交事件 | `form-submit` | `submit` |
| 提交按钮 part | `::part(submit-button)` | `::part(submit)` |
| `size` | attribute，property 反射 | property-only，不反射 |
| 默认 slot / `title` / `disabled` / `form-change` | 一致 | 一致 |

## 宿主兼容适配层（`src/contract/adapter.ts`）

开关式安装，全部动作发生在宿主侧，不改组件源码：

1. **事件转译**：在宿主节点监听新名 `submit`，重新派发旧名 `form-submit`；
2. **slot 桥接**：MutationObserver 把光域子节点的 `slot=actions` 改写为 `footer`；
3. **attribute→property 转发**：同步包装 `setAttribute/removeAttribute`，把 v2 移除的
   `size` attribute 写入 component property（property→attribute 的反向反射无法补，结论中显式登记）；
4. **part 垫片**：向组件 shadow root 注入等价样式规则。

关键边界：组件**不派发**事件、事件 **composed=false**、或 **part 被剥离**时，
适配层在 shadow 外无东西可监听 / 无选择器可命中——这些是组件必须修复的问题，垫片不能掩盖。

## 故障注入（全局开关 + 实例级覆盖）

- `drop-submit`：点击一切正常，但组件不派发提交事件；
- `force-non-composed`：提交事件止步 shadow root；
- `swallow-slots`：组件模板不声明具名 slot；
- `block-reflection`：property setter 不回写 attribute；
- `strip-parts`：内部按钮不带 part 属性。

## 七个验收步骤（`src/engine/runner.ts`）

每步都返回「期望 / 实测 / 解释」与真实 DOM 观察事实：

1. 内容投影：默认 slot 与具名 slot（flattened tree 的 `assignedNodes`）；
2. 属性反射：property→attribute 回写、attribute→property、observedAttributes；
3. 事件传播：真实点击 shadow 内部按钮，记录到达宿主的事件名与 `composedPath`；
4. 样式暴露：读取提交按钮 `getComputedStyle`，判定 `::part` 意图是否落地；
5. 重挂载：销毁后同配置重建并重放交互，验证全新 shadow root 上结论一致；
6. 多实例隔离：同页两实例，仅 B 注入实例级 drop-submit，验证故障不外溢、状态不泄漏；
7. 升级边界：标签先于 `customElements.define` 存在，验证升级后 shadow root 生成、
   光域子节点保留、slot 延迟解析、事件立即可用，以及适配层需在升级后重装。

## 操作能力

单步执行、自动运行（可中途停止）、v1/v2 版本切换、兼容适配开关、五种故障注入、
撤销 / 重做（快照历史）、**刷新恢复**（localStorage 只存配置与已执行步骤下标，
刷新后在全新挂载的真实 DOM 上重放并标记「已重放」，不跨 DOM 携带结论）、重置。

## 浏览器冒烟验收（需 Playwright Chromium）

```bash
npm run build && npx vite preview --port 4317 &
PLAYWRIGHT_BROWSERS_PATH=<浏览器目录> node scripts/smoke.mjs   # 11 项核心场景
                                                               # scripts/edge.mjs 7 项边界
```

脚本驱动真实 UI 并读取真实 Shadow DOM 判定，覆盖：v1 对照组、v2 静默丢失矩阵、
适配层恢复、三种不可适配故障、刷新重放、重置、open shadow root 结构、撤销重做与舞台活按钮直点。

## 目录结构

```
src/
  contract/
    types.ts        # 契约 / 判定 / 故障类型
    contracts.ts    # v1、v2 契约清单与改名映射
    elements.ts     # 双版本自定义元素工厂：真实 shadow DOM、故障注入、延迟升级
    adapter.ts      # 宿主侧兼容适配层
  engine/
    runner.ts       # 真实挂载舞台 + 七步探测与判定
  harness/
    state.ts        # reducer、撤销重做快照、持久化形状
    useHarness.ts   # 编排：生命周期、单步/自动、刷新重放
  ui/               # 契约面板 / 舞台 / 步骤 / 样式
scripts/
  smoke.mjs edge.mjs
```
