import { useState } from 'react';
import type { StepResult, Verdict } from '../contract/types';
import { STEP_META } from '../engine/runner';

const VERDICT_TEXT: Record<Verdict, string> = {
  pass: '通过',
  adapted: '兼容适配',
  loss: '静默丢失',
  fail: '故障',
  info: '信息',
};

const VERDICT_GUIDE: Record<Verdict, string> = {
  pass: '契约一致，宿主代码按原样工作。',
  adapted: '差异被宿主适配层弥合：行为可用，但依赖垫片，需登记技术债与下线计划。',
  loss: '没有报错、没有告警，但宿主契约静默失效（改名/不反射/选择器落空）。',
  fail: '组件侧契约被破坏（不派发/不穿越边界/不暴露 part），宿主适配无法补救。',
  info: '观察性结论，不构成通过或失败。',
};

function CheckBlock({ result }: { result: StepResult }) {
  return (
    <div className="step-detail">
      <p className="goal">探测目标：{STEP_META[result.index].goal}</p>
      {result.checks.map((c, i) => (
        <div className={`check ${c.verdict}`} key={i}>
          <b>
            <span className={`badge ${c.verdict}`}>{VERDICT_TEXT[c.verdict]}</span> {c.name}
          </b>
          <span className="vs">期望：{c.expected}</span>
          <span className="vs">实测：{c.actual}</span>
          <span className="why">{c.detail}</span>
        </div>
      ))}
      <div className="facts">
        <div className="facts-title">真实 DOM 观察事实</div>
        {Object.entries(result.facts).map(([k, v]) => (
          <div className="fact" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      {result.restored && (
        <p className="goal" style={{ marginTop: 8, color: '#0e7490' }}>
          此结论为刷新恢复后在全新挂载的真实 DOM 上重放得出（非缓存结果）。
        </p>
      )}
    </div>
  );
}

interface Props {
  results: (StepResult | null)[];
  onRun: (i: number) => void;
  disabled: boolean;
}

export function StepsPanel({ results, onRun, disabled }: Props) {
  const firstPending = results.findIndex((r) => r === null);
  const [open, setOpen] = useState<number | null>(0);

  const counts = (['fail', 'loss', 'adapted', 'pass', 'info'] as Verdict[]).map((v) => ({
    v,
    n: results.filter((r) => r?.verdict === v).length,
  }));

  return (
    <div className="card col-steps">
      <h3>
        验收步骤（真实 Shadow DOM · 单步可重放）
        <span className="summary-row">
          {counts.map(
            ({ v, n }) =>
              n > 0 && (
                <span className={`summary-pill ${v}`} key={v}>
                  {VERDICT_TEXT[v]} {n}
                </span>
              ),
          )}
        </span>
      </h3>
      <div className="body">
        <div className="diff-note" style={{ marginBottom: 10 }}>
          判定口径：<b>兼容适配</b>＝行为可用但靠宿主垫片；<b>静默丢失</b>＝无异常但宿主契约落空；
          <b>故障</b>＝组件破坏了传播/暴露契约。{VERDICT_GUIDE[firstPending === -1 ? 'info' : 'info']}
        </div>
        {STEP_META.map((meta, i) => {
          const result = results[i];
          const isOpen = open === i;
          return (
            <div className="step-item" key={i}>
              <div className="step-head" onClick={() => setOpen(isOpen ? null : i)}>
                <span className="step-num">{i + 1}</span>
                <span className="step-title">{meta.title}</span>
                <span className="step-dim">{meta.dimension}</span>
                <span className="step-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="mini-btn" disabled={disabled} onClick={() => onRun(i)}>
                    单步执行
                  </button>
                  {result ? (
                    <span className={`badge ${result.restored ? 'restored' : result.verdict}`}>
                      {result.restored ? '已重放' : VERDICT_TEXT[result.verdict]}
                    </span>
                  ) : (
                    <span className="badge pending">未执行</span>
                  )}
                </span>
              </div>
              {isOpen &&
                (result ? (
                  <CheckBlock result={result} />
                ) : (
                  <div className="step-detail">
                    <p className="goal">探测目标：{meta.goal}</p>
                    <p className="goal">尚未执行——点击「单步执行」或工具栏「自动运行」，结论来自对当前挂载实例的真实交互。</p>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
