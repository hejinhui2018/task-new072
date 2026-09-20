# SlotContract · Web Components 集成契约验收台

把一批旧组件升级成 Web Components 时，**组件看起来能渲染，提交按钮的事件却没有到达宿主**。
本台用 React + TypeScript + Vite 搭建一个零模拟的集成契约验收环境：真实 `attachShadow`、真实
`CustomEvent`、真实 `::part`，宿主页面始终按**旧版 v1 契约**编写，用来检验升级到底是向后兼容、
靠垫片适配、还是静默丢失。

## 它验收什么

每个组件版本维护一份完整契约（`src/contract/versions.ts`）：**slots / attributes / properties /
events / CSS parts**，并通过六步真实交互流逐项验收：

| # | 步骤 | 核心问题 |
|---|------|----------|
| ① | 挂载与注册 | 是否升级为自定义元素、shadowRoot open/closed |
| ② | 内容投影 | 旧 `slot="header"` 的 light DOM 节点是否真的被渲染 |
| ③ | 属性识别与回调 | 旧属性 `title` 是否进入 `observedAttributes` 并触发回调 |
| ④ | Property 与反射 | 旧名 property 写入是否驱动内部并反射回 attribute |
| ⑤ | **提交事件跨 shadow 边界** | 点 shadow 内按钮，业务宿主的 `card-submit` 是否命中 |
| ⑥ | CSS `::part` 暴露 | 宿主旧规则 `::part(submit-button)` 是否仍生效 |

每步给出四种结论并解释**实际发生了什么**：

- **直接满足 pass** — 原生行为即符合 v1 契约
- **兼容适配 adapted** — 靠显式垫片达成，报告列出“适配痕迹”和成本（可与静默丢失区分）
- **静默丢失 loss** — 不报错，但宿主侧契约失效（升级的主要风险）
- **硬失败 fail** — 显式报错或事件被明确 `stopPropagation` 截停

## 三个版本

- **v1（旧版基线）**：`slot-card-v1`，旧槽位 `header`、旧事件 `card-submit(composed:true)`、旧 part `submit-button`。
- **v2（破坏性升级）**：`slot-card-v2`，槽位/属性/事件/part 全部改名，且提交事件 **`composed:false`**。
  事件止步 shadow root（实测连 host 自身都收不到），叠加事件改名，形成两层无报错断裂 —— 即题述故障的真身。
- **v2+（v2 内核 + 兼容适配层）**：同一内核，加四处显式适配：
  - 模板在 `titlebar` 回退位嵌套 `<slot name="header">`，桥接旧投影；
  - `observedAttributes` 增加旧名，回调转发并补反射；
  - 旧名 property 别名访问器；
  - 内部事件之后在 host 上**重新派发** `card-submit(composed:true, detail.via=compat-alias)`；
  - 内部按钮 `part="submit submit-button"` 双导出。

## 故障注入（可叠加）

`submit.composed=false` · `closed ShadowRoot` · `内部 stopPropagation` · `header 槽位缺失` ·
`隐藏 submit part` · `property 不反射` · `多实例共享状态`。结论由真实探针观测推导，故障会真实翻转判定。

## 边界套件

工具栏一键运行（在隐藏舞台中真实挂载/卸载）：

- **升级边界**：元素先以未注册标签入 DOM（HTMLUnknownElement 形态），再 `customElements.define`，
  验证升级不丢 light DOM、升级前预置旧属性在补回调瞬间是否被接住、升级后事件面是否“活过来”；
- **重挂载**：同一节点移出/插回的 `connectedCallback` 幂等（不重复 attachShadow、不重复绑监听）、
  监听随节点保留、卸载后新建实例不继承旧状态；
- **多实例隔离**：只点实例 A 时事件不到宿主 B、property 实例私有、shadow 结构独立。

## 交互能力

单步执行（重放到指定步骤）/ 自动运行全部 / 版本切换 / 故障注入 / 撤销重做（配置历史栈）/
重置 / **刷新恢复**（配置与报告持久化到 localStorage，恢复结果标记“快照/stale”，重新执行即回现场）。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
```

### E2E（真实 Chromium 驱动 UI）

```bash
npm run dev &      # 先起 dev server
npm run test:e2e       # 六步结论矩阵 / 版本切换 / 故障 / 撤销重做 / 刷新恢复
npm run test:matrix    # 逐个故障翻转验证 + 现场点击 + 边界套件 sharedState
```

测试用 `playwright-core` 连接外部浏览器，路径通过 `HEADLESS_SHELL` 环境变量指定。

## 目录

```
src/
  contract/      契约模型（types）与三版本谱系（versions）
  element/       真实自定义元素工厂、故障注入、受信任探针、注册中心（含升级用未注册标签）
  engine/        mountBench（按 v1 编写的业务宿主 + 会话）、runChecks（六步）、suites（边界套件）
  state/         reducer（撤销重做/持久化）、stepOrder、useBench（会话生命周期编排）
  components/    工具栏、宿主面板、元素现场探针、验收报告、套件、日志控制台
tests/           Playwright 真实浏览器验收
```
