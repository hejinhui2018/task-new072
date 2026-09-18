import { CancelSpec, PRIORITY_LABEL, Priority, TASK_KIND_LABEL, TaskKind, TaskSpec } from '../engine/types'
import { KIND_SWATCH } from './Timeline'

interface Props {
  tasks: TaskSpec[]
  cancels: CancelSpec[]
  onChangeTasks: (tasks: TaskSpec[]) => void
  onChangeCancels: (cancels: CancelSpec[]) => void
  onResetScenario: () => void
}

const PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low']
const KINDS: TaskKind[] = ['decode', 'layout', 'log', 'preload', 'custom']

export default function TaskEditor({
  tasks,
  cancels,
  onChangeTasks,
  onChangeCancels,
  onResetScenario,
}: Props) {
  const update = (id: string, patch: Partial<TaskSpec>) =>
    onChangeTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const removeTask = (id: string) => {
    onChangeTasks(tasks.filter((t) => t.id !== id))
    onChangeCancels(cancels.filter((c) => c.taskId !== id))
  }

  const addCustom = () => {
    const n = tasks.filter((t) => t.kind === 'custom').length + 1
    onChangeTasks([
      ...tasks,
      {
        id: `custom-${Date.now()}-${n}`,
        label: `自定义任务 ${n}`,
        kind: 'custom',
        priority: 'normal',
        durationMs: 4,
        arrivalFrame: 0,
        cancelable: true,
      },
    ])
  }

  const addCancelFor = (taskId: string, atFrame: number) => {
    if (cancels.some((c) => c.taskId === taskId)) return
    onChangeCancels([...cancels, { taskId, atFrame }])
  }

  const cancelOf = (taskId: string) => cancels.find((c) => c.taskId === taskId)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="btn" onClick={addCustom}>
          ＋ 添加主线程任务
        </button>
        <button className="btn" onClick={onResetScenario}>
          ↺ 恢复内置场景
        </button>
        <span style={{ flex: 1 }} />
        <span className="cancel-row" style={{ margin: 0 }}>
          提示：修改任意参数都会<b style={{ color: 'var(--ink)' }}>确定性地重算</b>整条时间线
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
        {tasks.map((t) => {
          const cancel = cancelOf(t.id)
          return (
            <div className="task-card" key={t.id}>
              <div className="task-head">
                <span className="task-dot" style={{ background: KIND_SWATCH[t.kind] }} />
                <span className="task-name" title={t.id}>
                  {t.label}
                </span>
                <span className="task-kind">{TASK_KIND_LABEL[t.kind]}</span>
                <button className="icon-btn" title="删除任务" onClick={() => removeTask(t.id)}>
                  ✕
                </button>
              </div>
              <div className="task-grid">
                <div className="field">
                  <label>优先级</label>
                  <select
                    value={t.priority}
                    onChange={(e) => update(t.id, { priority: e.target.value as Priority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>类型</label>
                  <select
                    value={t.kind}
                    onChange={(e) => update(t.id, { kind: e.target.value as TaskKind })}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {TASK_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>预计耗时（ms）</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={t.durationMs}
                    onChange={(e) => update(t.id, { durationMs: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  />
                </div>
                <div className="field">
                  <label>到达帧（第几帧 vsync）</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={t.arrivalFrame}
                    onChange={(e) => update(t.id, { arrivalFrame: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  />
                </div>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={t.cancelable}
                    onChange={(e) => update(t.id, { cancelable: e.target.checked })}
                  />
                  可取消 / 可在帧边界协作让出（不可取消的任务一旦开始即为原子长任务）
                </label>

                {cancel ? (
                  <div className="cancel-row" style={{ gridColumn: '1 / -1' }}>
                    <span title="取消请求">●</span>
                    在第
                    <input
                      type="number"
                      min={0}
                      style={{
                        width: 64,
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 5,
                        padding: '3px 6px',
                      }}
                      value={cancel.atFrame}
                      onChange={(e) =>
                        onChangeCancels(
                          cancels.map((c) =>
                            c.taskId === t.id
                              ? { ...c, atFrame: Math.max(0, Math.floor(Number(e.target.value) || 0)) }
                              : c,
                          ),
                        )
                      }
                    />
                    帧请求取消
                    <button
                      className="icon-btn"
                      title="移除取消请求"
                      onClick={() => onChangeCancels(cancels.filter((c) => c.taskId !== t.id))}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="cancel-row" style={{ gridColumn: '1 / -1' }}>
                    <button className="btn" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => addCancelFor(t.id, t.arrivalFrame)}>
                      ● 添加取消请求
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
