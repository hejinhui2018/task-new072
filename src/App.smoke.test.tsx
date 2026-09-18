import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('应用渲染冒烟（无浏览器环境下保证整树可挂载）', () => {
  it('默认“切换直播画面”场景可以完整渲染出关键面板', () => {
    const html = renderToString(<App />)
    expect(html).toContain('前端性能巡检台')
    expect(html).toContain('帧时间线')
    expect(html).toContain('巡检结论')
    expect(html).toContain('解码新画面分片')
    expect(html).toContain('预加载下一机位')
    // 默认场景掉帧帧号被标出
    expect(html).toContain('frame-chip')
  })
})
