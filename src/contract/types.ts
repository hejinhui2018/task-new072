export type VersionId = 'v1' | 'v2';

export type Verdict = 'pass' | 'adapted' | 'loss' | 'fail' | 'info';

export type Dimension = 'slots' | 'attributes' | 'properties' | 'events' | 'parts';

export interface SlotSpec {
  /** 空字符串表示默认 slot */
  name: string;
  label: string;
  required?: boolean;
}

export interface AttrSpec {
  name: string;
  label: string;
  type: 'string' | 'boolean' | 'number';
  /** 属性 -> 属性所属 property */
  property: string;
  /** property 写回时是否反射到 attribute */
  reflects: boolean;
}

export interface PropSpec {
  name: string;
  label: string;
  type: 'string' | 'boolean' | 'number';
  readOnly?: boolean;
}

export interface EventSpec {
  name: string;
  label: string;
  bubbles: boolean;
  composed: boolean;
  detail: string;
}

export interface PartSpec {
  name: string;
  label: string;
  expose: string;
}

export interface VersionContract {
  version: VersionId;
  tag: string;
  label: string;
  slots: SlotSpec[];
  attributes: AttrSpec[];
  properties: PropSpec[];
  events: EventSpec[];
  parts: PartSpec[];
  cssVars: string[];
}

export type FaultId =
  | 'drop-submit'
  | 'force-non-composed'
  | 'swallow-slots'
  | 'block-reflection'
  | 'strip-parts';

export type FaultSet = Partial<Record<FaultId, boolean>>;

export interface CheckResult {
  name: string;
  verdict: Verdict;
  expected: string;
  actual: string;
  detail: string;
}

export interface StepResult {
  index: number;
  title: string;
  dimension: Dimension | 'lifecycle';
  verdict: Verdict;
  checks: CheckResult[];
  /** 本次探测在真实 DOM 上观察到的事实，供解释面板引用 */
  facts: Record<string, string>;
  restored?: boolean;
  ts: number;
}
