import type { RefObject } from 'react';

export function StagePanel({ stageRef }: { stageRef: RefObject<HTMLDivElement> }) {
  return (
    <div className="card">
      <h3>
        真实挂载舞台
        <span className="summary-pill">open Shadow DOM · 可直接点击</span>
      </h3>
      <div className="body">
        <div className="stage-wrap" ref={stageRef} />
        <div className="legend">
          <span className="legend-item">
            <span className="dot pass" /> 一致通过
          </span>
          <span className="legend-item">
            <span className="dot adapted" /> 兼容适配（垫片生效）
          </span>
          <span className="legend-item">
            <span className="dot loss" /> 静默丢失（无异常但落空）
          </span>
          <span className="legend-item">
            <span className="dot fail" /> 组件故障（适配无法补救）
          </span>
        </div>
        <p className="goal" style={{ marginTop: 10 }}>
          舞台上的按钮都是活的：点击组件内部「提交订单」会真实派发 CustomEvent；灰色区域是宿主业务页面，
          它的样式表、事件监听、slot 投射全部按 v1 契约编写，不随版本切换改动。
        </p>
      </div>
    </div>
  );
}
