import { useHarness } from './harness/useHarness';
import { ContractPanel } from './ui/ContractPanel';
import { StagePanel } from './ui/StagePanel';
import { StepsPanel } from './ui/StepsPanel';
import type { FaultId } from './contract/types';

const FAULTS: { id: FaultId; name: string; desc: string }[] = [
  { id: 'drop-submit', name: '丢弃提交事件', desc: '点击一切正常，但组件不派发提交事件' },
  { id: 'force-non-composed', name: '事件不 composed', desc: '提交事件止步 shadow root，宿主收不到' },
  { id: 'swallow-slots', name: '不声明具名 slot', desc: '组件模板移除 footer 槽，投影无处可去' },
  { id: 'block-reflection', name: '切断 property 反射', desc: 'property 写入不回写 attribute' },
  { id: 'strip-parts', name: '剥离 CSS parts', desc: '内部按钮不带 part 属性，外部样式不可达' },
];

const CONCEPTS: { title: string; text: string }[] = [
  {
    title: '内容投影（Slot）',
    text: '宿主光域子节点不被组件复制，而是经 slot 名匹配进入 flattened tree。默认 slot 总是接收无名字节点；具名 slot 靠名字匹配——名字改了又没有适配层，节点仍在 DOM 里却不渲染，且不报错。',
  },
  {
    title: '属性反射（Reflection）',
    text: 'attribute 是字符串化的单一事实源，property 是 JS 侧入口。setter 内部回写 attribute 叫反射；v2 把 size 收窄为 property-only 后，宿主的 setAttribute 与 [size] 样式钩子双双静默失效。',
  },
  {
    title: '事件传播（Retarget / composed）',
    text: 'shadow 内部事件只有 composed 才能穿越边界，到达光域时目标被 retarget 为宿主节点。事件名改了，裸事件照样到达、却没有业务监听者；composed=false 或不派发时，宿主侧适配器也无从补救。',
  },
  {
    title: '样式暴露（::part）',
    text: '外部只能样式化组件显式暴露的 part。::part(旧名) 不匹配新 part 时规则被静默跳过；适配层可向 shadow root 注入等价样式救场，但 part 被剥离时垫片无选择器可命中——“垫片已安装”不等于“垫片生效”。',
  },
];

export default function App() {
  const h = useHarness();
  const { present } = h;

  return (
    <div className="app">
      <header className="app-header">
        <h1>SlotContract · Web Components 集成契约验收台</h1>
        <p>
          宿主业务页面锁定 <code>order-form v1</code> 契约，设计系统升级到 <code>v2</code>。
          真实挂载 open Shadow DOM，验证 slots / attributes / properties / events / parts 五条契约面，
          区分<b>兼容适配</b>与<b>静默丢失</b>。
        </p>
      </header>

      <div className={`banner ${h.hydrated ? '' : 'off'}`}>
        已从上次会话恢复：版本 / 适配 / 故障配置与已执行步骤已重放——结论是在刷新后全新挂载的真实 DOM 上重新探测得出的，而非读取缓存。
      </div>

      <div className="toolbar">
        <div className="toolgroup">
          <span className="lbl">组件版本</span>
          <div className="seg">
            <button className={`tbtn ${present.version === 'v1' ? 'active' : ''}`} onClick={() => h.setVersion('v1')}>
              v1 旧版
            </button>
            <button className={`tbtn ${present.version === 'v2' ? 'active' : ''}`} onClick={() => h.setVersion('v2')}>
              v2 新版
            </button>
          </div>
        </div>
        <div className="toolgroup">
          <label className="fault-chip" style={{ maxWidth: 'none' }}>
            <input type="checkbox" checked={present.compat} onChange={h.toggleCompat} />
            <span>
              <b>安装宿主兼容适配层</b>（事件转译 / slot 改名 / attr→prop 转发 / part 垫片）
            </span>
          </label>
        </div>
        <div className="toolgroup">
          <button className="tbtn primary" disabled={!h.ready || h.isAuto} onClick={h.runAll}>
            自动运行
          </button>
          {h.isAuto && (
            <button className="tbtn danger" onClick={h.stopAuto}>
              停止
            </button>
          )}
        </div>
        <div className="toolgroup">
          <button className="tbtn" disabled={!h.canUndo || h.isAuto} onClick={h.undo}>
            ↶ 撤销
          </button>
          <button className="tbtn" disabled={!h.canRedo || h.isAuto} onClick={h.redo}>
            ↷ 重做
          </button>
          <button className="tbtn danger" disabled={!h.ready} onClick={h.reset}>
            重置
          </button>
        </div>
      </div>

      <div className="faults">
        <div className="faults-title">故障注入（模拟组件升级回归；切换任意配置都会重建舞台并使旧结论失效）</div>
        <div className="fault-grid">
          {FAULTS.map((f) => (
            <label className="fault-chip" key={f.id}>
              <input
                type="checkbox"
                checked={!!present.faults[f.id]}
                onChange={() => h.toggleFault(f.id)}
              />
              <span>
                <b>{f.name}</b>
                <br />
                <span>{f.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid">
        <ContractPanel version={present.version} />
        <StagePanel stageRef={h.stageRef} />
        <StepsPanel results={present.results} onRun={h.runStep} disabled={!h.ready || h.isAuto} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>四个机制：验收实际在解释什么</h3>
        <div className="body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {CONCEPTS.map((c) => (
            <div key={c.title}>
              <b style={{ fontSize: 13 }}>{c.title}</b>
              <p className="goal" style={{ marginTop: 4 }}>{c.text}</p>
            </div>
          ))}
        </div>
        <div className="body" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <b style={{ fontSize: 13 }}>建议验收路径</b>
          <ol className="goal" style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
            <li><b>v1 自动运行</b>：七步全绿，建立对照组。</li>
            <li><b>切到 v2、不开适配</b>：观察 slot / size / submit 事件 / part 全部静默丢失（loss），组件却“看起来正常”。</li>
            <li><b>打开适配层</b>：同样四处变为「兼容适配」——行为恢复，但结论标注垫片依赖与单向补偿的边界。</li>
            <li><b>逐项注入故障</b>：drop-submit 与 non-composed 即使开着适配层仍是 fail——这是组件必须修复、宿主无法掩盖的边界。</li>
            <li>再试重挂载、多实例隔离、延迟升级三步，以及刷新页面后的自动重放与撤销/重做。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
