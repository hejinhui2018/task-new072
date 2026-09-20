import type { Verdict } from '../contract/types'

const LABEL: Record<Verdict, string> = {
  pass: '直接满足',
  adapted: '兼容适配',
  loss: '静默丢失',
  fail: '硬失败',
}

export function VerdictBadge({ verdict, mini }: { verdict: Verdict | null | undefined; mini?: boolean }) {
  if (!verdict) return <span className="v idle">未执行</span>
  return (
    <span className={`v ${verdict}`}>
      <span className={`dot ${verdict}`} />
      {mini ? verdict : LABEL[verdict]}
    </span>
  )
}

export function verdictLabel(v: Verdict): string {
  return LABEL[v]
}
