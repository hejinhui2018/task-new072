import { useEffect, useMemo, useRef, useState } from 'react'
import { simulate } from './engine/scheduler'
import { SWITCH_LIVE_SCENARIO } from './engine/scenarios'
import { buildNarrations } from './engine/narrative'
import { CancelSpec, TaskKind, TaskSpec } from './engine/types'
import Timeline, { Legend } from './components/Timeline'
import TaskEditor from './components/TaskEditor'
import { FrameInspector, OutcomesTable } from './components/Inspector'

const SPEEDS = [
  { label: '0.5×', ms: 1200 },
  { label: '1×', ms: 650 },
  { label: '2×', ms: 320 },
]
const ZOOMS = [
  { label: '窄', px: 0.45 },
  { label: '标准', px: 0.9 },
  { label: '宽', px: 1.5 },
]

export default function App() {
  const [tasks, setTasks] = useState<TaskSpec[]>(() =>
    SWITCH_LIVE_SCENARIO.tasks.map((t) => ({ ...t })),
  )
  const [cancels, setCancels] = useState<CancelSpec[]>([])
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(1)
  const [zoomIdx, setZoomIdx] = useState(1)
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)

  const result = useMemo(() => simulate({ tasks, cancels }), [tasks, cancels])
  // 默认场景作为巡检基线：所有调参都与它对比
  const baseline = useMemo(() => simulate(SWITCH_LIVE_SCENARIO), [])
  const narrations = useMemo(() => buildNarrations(result), [result])
  const kindById = useMemo(() => {
    const m: Record<string, TaskKind> = {}
    tasks.forEach((t) => (m[t.id] = t.kind))
    return m
  }, [tasks])

  const frameCount = result.frames.length
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, frameCount - 1)))
  }, [frameCount])

  // 播放循环：每 SPEEDS[speedIdx].ms 推进一帧，到结尾自动暂停
  useEffect(() => {
    if (!playing) return
    if (cursor >= frameCount - 1) {
      setPlaying(false)
      return
    }
    timerRef.current = window.setTimeout(() => {
      setCursor((c) => Math.min(c + 1, frameCount - 1))
    }, SPEEDS[speedIdx].ms)
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [playing, cursor, frameCount, speedIdx])

  const togglePlay = () => {
    if (!playing && cursor >= frameCount - 1) setCursor(0)
    setPlaying((p) => !p)
  }
  const step = () => {
    setPlaying(false)
    setCursor((c) => Math.min(c + 1, frameCount - 1))
  }
  const replay = () => {
    setCursor(0)
    setPlaying(true)
  }
  const resetScenario = () => {
    setTasks(SWITCH_LIVE_SCENARIO.tasks.map((t) => ({ ...t })))
    setCancels([])
    setCursor(0)
    setSelectedFrame(null)
    setPlaying(false)
  }

  const s = result.stats
  const dDrop = s.droppedCount - baseline.stats.droppedCount
  const dTime = s.completionTimeMs - baseline.stats.completionTimeMs
  const deltaText = (d: number, unit: string) =>
    d === 0 ? '与基线持平' : `${d > 0 ? '+' : ''}${d.toFixed(d % 1 === 0 ? 0 : 1)}${unit}（对比默认场景）`

  return (
    <div className="app">
      <header className="app-header">
        <h1>直播控制室 · 前端性能巡检台</h1>
        <span className="subtitle">按帧（{result.budgetMs}ms vsync 预算）回放主线程占用 · 本地确定性模拟，无真实设备依赖</span>
      </header>

      {/* 指标瓦片 */}
      <section className="panel">
        <h2 className="panel-title">巡检指标（改任意参数立即重算）</h2>
        <div className="stats-row">
          <div className="stat">
            <div className="stat-label">掉帧</div>
            <div className={'stat-value ' + (s.droppedCount === 0 ? 'good' : 'bad')}>{s.droppedCount} 帧</div>
            <div className="stat-sub" style={{ color: dDrop <= 0 ? 'var(--st-good)' : 'var(--st-critical)' }}>
              {deltaText(dDrop, ' 帧')}
            </div>
            {s.droppedFrames.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {s.droppedFrames.map((f) => (
                  <span className="frame-chip" key={f}>
                    #{f}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="stat">
            <div className="stat-label">全部任务完成时间</div>
            <div className="stat-value">{s.completionTimeMs.toFixed(1)} ms</div>
            <div className="stat-sub">
              {s.completionFrame} 帧 ·{' '}
              <span style={{ color: dTime <= 0 ? 'var(--st-good)' : 'var(--st-critical)' }}>
                {deltaText(dTime, 'ms')}
              </span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">长任务（不可中断，越过 vsync）</div>
            <div className={'stat-value ' + (s.longTaskCount === 0 ? 'good' : 'bad')}>{s.longTaskCount}</div>
            <div className="stat-sub">主线程累计占用 {s.totalMainThreadMs.toFixed(1)}ms</div>
          </div>
          <div className="stat">
            <div className="stat-label">推迟 / 帧边界让出</div>
            <div className="stat-value" style={{ color: 'var(--ink)' }}>
              {s.deferredCount}
              <span style={{ color: 'var(--ink-muted)', fontSize: 16 }}> / {s.preemptedSliceCount}</span>
            </div>
            <div className="stat-sub">推迟次数 / 抢占切片数（让出不掉帧）</div>
          </div>
          <div className="stat">
            <div className="stat-label">取消带来的节省 / 白跑</div>
            <div className="stat-value" style={{ color: 'var(--ink)' }}>
              <span style={{ color: 'var(--st-good)' }}>{s.savedMsByCancel.toFixed(1)}</span>
              <span style={{ color: 'var(--ink-muted)', fontSize: 15 }}> / </span>
              <span style={{ color: s.wastedMsByCancel > 0 ? 'var(--st-warning)' : 'var(--ink-muted)' }}>
                {s.wastedMsByCancel.toFixed(1)}
              </span>
              <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}> ms</span>
            </div>
            <div className="stat-sub">避免占用主线程 / 取消前已执行</div>
          </div>
        </div>
      </section>

      <div className="layout-grid">
        {/* 左：时间线 */}
        <div>
          <section className="panel" style={{ marginTop: 0 }}>
            <h2 className="panel-title">帧时间线</h2>
            <div className="transport">
              <button className="btn primary" onClick={togglePlay} disabled={frameCount === 0}>
                {playing ? '⏸ 暂停' : '▶ 播放'}
              </button>
              <button className="btn" onClick={step} disabled={playing || cursor >= frameCount - 1}>
                ⏭ 单步
              </button>
              <button className="btn" onClick={replay}>
                ↺ 重放
              </button>
              <span className="cursor-info">
                第 {frameCount === 0 ? 0 : cursor + 1} / {frameCount} 帧 · 墙钟{' '}
                {(Math.min(cursor + 1, frameCount) * result.budgetMs).toFixed(0)}ms
              </span>
              <span className="spacer" />
              <select value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))}>
                {SPEEDS.map((sp, i) => (
                  <option key={sp.label} value={i}>
                    播放速度 {sp.label}
                  </option>
                ))}
              </select>
              <span className="zoom-row">
                缩放
                {ZOOMS.map((z, i) => (
                  <button key={z.label} className={zoomIdx === i ? 'on' : ''} onClick={() => setZoomIdx(i)}>
                    {z.label}
                  </button>
                ))}
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <Timeline
                result={result}
                kindById={kindById}
                cursor={cursor}
                selectedFrame={selectedFrame}
                onSelectFrame={(i) => {
                  setPlaying(false)
                  setCursor(i)
                  setSelectedFrame(i)
                }}
                pxPerTick={ZOOMS[zoomIdx].px}
              />
            </div>
            <Legend kinds={[...new Set(tasks.map((t) => t.kind))]} />
            <p className="scenario-desc" style={{ marginTop: 8 }}>
              ▲ 任务在帧首 vsync 入队；● 黄色为取消成功、红边为取消被拒；红色斜纹切片是越过 16ms
              截止线的长任务；虚线右边框表示可取消任务在帧边界主动让出。点击帧标尺可逐帧检视。
            </p>
          </section>

          <OutcomesTable result={result} tasks={tasks} />
        </div>

        {/* 右：检视器 + 结论 */}
        <div>
          <FrameInspector result={result} frameIndex={selectedFrame} />
          <section className="panel">
            <h2 className="panel-title">巡检结论 · 数据解释</h2>
            <ul className="narrative" style={{ margin: 0, paddingLeft: 18 }}>
              {narrations.map((n) => (
                <li
                  key={n.id}
                  style={{
                    color:
                      n.tone === 'bad'
                        ? 'var(--st-critical)'
                        : n.tone === 'warn'
                          ? 'var(--st-warning)'
                          : n.tone === 'good'
                            ? 'var(--ink-2)'
                            : 'var(--ink-2)',
                  }}
                >
                  {n.text}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* 任务编辑 */}
      <section className="panel">
        <h2 className="panel-title">场景：{SWITCH_LIVE_SCENARIO.name}</h2>
        <p className="scenario-desc">{SWITCH_LIVE_SCENARIO.description}</p>
        <div style={{ marginTop: 10 }}>
          <TaskEditor
            tasks={tasks}
            cancels={cancels}
            onChangeTasks={setTasks}
            onChangeCancels={setCancels}
            onResetScenario={resetScenario}
          />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">模拟模型说明</h2>
        <ul className="narrative" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            主线程以 <b>0.1ms 为最小刻度</b>做整数调度；第 i 帧窗口为 [i×16, i×16+16) ms，对应一次
            vsync。窗口只看到帧首已入队的任务。
          </li>
          <li>
            任务按 <b>优先级（关键 &gt; 高 &gt; 普通 &gt; 低）→ 到达帧 → id</b> 选取，与列表顺序无关。
          </li>
          <li>
            <b>可取消</b>且耗时超过一整帧的任务会在帧边界协作让出（绿色虚线边切片）；短于一帧但当前剩余预算不够的任务整任务推迟，让更短任务填洞。
          </li>
          <li>
            <b>不可取消</b>任务一旦开始即原子执行完，越过 vsync 线就是长任务（红斜纹），溢出的占用会让后续帧整帧或部分阻塞 → 掉帧。
          </li>
          <li>取消在帧首裁决：未开始→已取消；跑了一部分→部分取消（白跑已执行时间，省下剩余时间）；已结束/不可取消/不在队列→拒绝。</li>
          <li>
            整个模拟器是<b>无随机数、无时钟的纯函数</b>：同一组参数（含取消帧）永远产生同一条时间线，播放/暂停/单步/重放只改变“看”到第几帧。
          </li>
        </ul>
      </section>
    </div>
  )
}
