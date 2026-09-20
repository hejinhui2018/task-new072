import { CONTRACTS, HOST_VERSION } from '../contract/contracts';
import type { Dimension, VersionContract, VersionId } from '../contract/types';

type RowStatus = 'same' | 'changed' | 'removed' | 'added';

interface Row {
  key: string;
  html: React.ReactNode;
  status: RowStatus;
  tag: string;
}

function tag(status: RowStatus): string {
  return { same: '一致', changed: '改名/变更', removed: '移除', added: '新增' }[status];
}

function buildRows(host: VersionContract, target: VersionContract): Record<Dimension, Row[]> {
  const isV1 = target.version === 'v1';

  const slots: Row[] = host.slots.map((s) => {
    if (s.name === '') return { key: 'default', html: <>默认 slot（<code>""</code>）{s.label}</>, status: 'same', tag: tag('same') };
    if (isV1) return { key: s.name, html: <><code>slot="{s.name}"</code> {s.label}</>, status: 'same', tag: tag('same') };
    return {
      key: s.name,
      html: <><code>slot="actions"</code> → 宿主投射旧名；v2 接收 <code>slot="footer"</code></>,
      status: 'changed',
      tag: tag('changed'),
    };
  });

  const attrKeys = new Set([...host.attributes.map((a) => a.name), ...target.attributes.map((a) => a.name)]);
  const attributes: Row[] = [];
  attrKeys.forEach((name) => {
    const h = host.attributes.find((a) => a.name === name);
    const t = target.attributes.find((a) => a.name === name);
    if (h && t) {
      const reflectChange = h.reflects !== t.reflects;
      attributes.push({
        key: name,
        html: (
          <>
            <code>{name}</code>
            {reflectChange ? ' · v2 不再反射（property-only）' : ` · 反射 ↔ ${h.property}`}
          </>
        ),
        status: reflectChange ? 'changed' : 'same',
        tag: reflectChange ? tag('changed') : tag('same'),
      });
    } else if (h && !t) {
      attributes.push({
        key: name,
        html: <><code>{name}</code> attribute · v2 从观察属性中移除，仅留 property</>,
        status: 'removed',
        tag: tag('removed'),
      });
    } else {
      attributes.push({ key: name, html: <><code>{name}</code> 新增 attribute</>, status: 'added', tag: tag('added') });
    }
  });

  const propKeys = new Set([...host.properties.map((p) => p.name), ...target.properties.map((p) => p.name)]);
  const properties: Row[] = [];
  propKeys.forEach((name) => {
    const h = host.properties.find((p) => p.name === name);
    const t = target.properties.find((p) => p.name === name);
    if (h && t) {
      properties.push({ key: name, html: <><code>{name}</code> {t.label}</>, status: 'same', tag: tag('same') });
    } else if (h) {
      properties.push({ key: name, html: <><code>{name}</code> 移除</>, status: 'removed', tag: tag('removed') });
    } else {
      properties.push({ key: name, html: <><code>{name}</code> · {t!.label}</>, status: 'added', tag: tag('added') });
    }
  });

  const events: Row[] = [];
  if (isV1) {
    host.events.forEach((e) =>
      events.push({ key: e.name, html: <><code>{e.name}</code> · bubbles/composed · {e.detail}</>, status: 'same', tag: tag('same') }),
    );
  } else {
    events.push({
      key: 'form-submit',
      html: <>宿主监听 <code>form-submit</code>；v2 派发 <code>submit</code>（同名业务回调失效）</>,
      status: 'changed',
      tag: tag('changed'),
    });
    events.push({
      key: 'form-change',
      html: <><code>form-change</code> · bubbles/composed · {'{ qty }'} · 未改名</>,
      status: 'same',
      tag: tag('same'),
    });
  }

  const partKeys = new Set([...host.parts.map((p) => p.name), ...target.parts.map((p) => p.name)]);
  const parts: Row[] = [];
  partKeys.forEach((name) => {
    const h = host.parts.find((p) => p.name === name);
    const t = target.parts.find((p) => p.name === name);
    if (h && t) {
      parts.push({ key: name, html: <><code>::part({name})</code> · {h.expose}</>, status: 'same', tag: tag('same') });
    } else if (h) {
      const replacement = target.parts.find((p) => p.expose === h.expose);
      parts.push({
        key: name,
        html: (
          <>
            <code>::part({name})</code> → v2 暴露 <code>::part({replacement?.name ?? '?'})</code>
          </>
        ),
        status: 'changed',
        tag: tag('changed'),
      });
    } else {
      parts.push({ key: name, html: <><code>::part({name})</code> 新增暴露面</>, status: 'added', tag: tag('added') });
    }
  });

  return { slots, attributes, properties, events, parts };
}

const DIMENSION_LABELS: Record<Dimension, string> = {
  slots: 'Slots 内容投影',
  attributes: 'Attributes 属性',
  properties: 'Properties 属性',
  events: 'Events 事件',
  parts: 'CSS Parts 样式暴露',
};

export function ContractPanel({ version }: { version: VersionId }) {
  const host = CONTRACTS[HOST_VERSION];
  const target = CONTRACTS[version];
  const rows = buildRows(host, target);
  const changedCount = Object.values(rows)
    .flat()
    .filter((r) => r.status !== 'same').length;

  return (
    <div className="card">
      <h3>
        集成契约
        <span className="summary-pill">{version === 'v1' ? '无差异' : `${changedCount} 处差异`}</span>
      </h3>
      <div className="body">
        <div className="contract-head">
          <span className="who">
            宿主（业务页面）锁定 <code>{host.tag}</code>
          </span>
        </div>
        <div className="diff-note">
          当前挂载 <code>{target.tag}</code>。
          {version === 'v1'
            ? '同版本运行：所有契约面一致，用作对照组。'
            : '宿主侧代码不改动；是否安装兼容适配层决定差异表现为“兼容适配”还是“静默丢失”。'}
        </div>
        {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((d) => (
          <div className="dim" key={d}>
            <p className="dim-name">{DIMENSION_LABELS[d]}</p>
            {rows[d].map((r) => (
              <div className={`spec-row ${r.status}`} key={r.key}>
                {r.html}
                <span className={`tag-mini ${r.status}`}>{r.tag}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
