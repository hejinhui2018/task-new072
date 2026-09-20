import { useEffect, useRef } from 'react'
import type { LogEntry } from '../contract/types'

const PHASE_LABEL: Record<LogEntry['phase'], string> = {
  host: '宿主',
  element: '元素',
  engine: '引擎',
  compat: '适配层',
}

export function LogConsole({ logs, height }: { logs: LogEntry[]; height?: number }) {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  return (
    <ul className="logs" ref={ref} style={height ? { maxHeight: height } : undefined}>
      {logs.length === 0 && <li><span className="mini">（暂无内部日志）</span></li>}
      {logs.map((l, i) => (
        <li key={i} className={l.level}>
          <span className="ph">[{PHASE_LABEL[l.phase]}]</span>
          <span className="m">{l.message}</span>
        </li>
      ))}
    </ul>
  )
}
