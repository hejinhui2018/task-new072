// 真实 Chromium 冒烟：驱动验收台 UI，断言各版本/故障下的结论矩阵
import { chromium } from 'playwright-core'

const SHELL = process.env.HEADLESS_SHELL || '/tmp/pw-browsers/chromium_headless_shell-1187/chrome-linux/headless_shell'
const errors = []
const browser = await chromium.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/syslib/usr/lib/x86_64-linux-gnu:/tmp/syslib/lib/x86_64-linux-gnu' },
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.app-header')

async function stepVerdicts() {
  const out = {}
  const steps = await page.$$('[data-testid="report-panel"] .step')
  for (const s of steps) {
    const title = (await s.$eval('.t', (el) => el.textContent.trim())).replace(/ · 当前位置/, '')
    const badge = await s.$eval('.v', (el) => el.textContent.trim()).catch(() => '?')
    out[title] = badge
  }
  return out
}
async function reportStep(num) {
  return (await page.$$('[data-testid="report-panel"] .step'))[num - 1]
}
async function clickByText(sel, text) {
  const btns = await page.$$(sel)
  for (const b of btns) {
    if ((await b.textContent()).trim() === text) { await b.click(); return true }
  }
  return false
}
async function pickVersion(v) { await page.click(`.ver-selector button:has-text("${v}")`) }
async function toggleFault(label) { await page.click(`label.chip:has-text("${label}")`) }
async function expandStep(num) { ;(await reportStep(num)).$('.step-h').then(h => h.click()) }
async function actualText(num) {
  const el = await reportStep(num)
  return el.$eval('.actual', (n) => n.textContent.trim())
}

// 等首步挂载
await page.waitForTimeout(600)

// ── 场景一：默认 v2，自动跑满 ──
await clickByText('button.btn', '自动运行全部')
await page.waitForFunction(() => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.trim() === '停止自动'), null, { timeout: 10000 })
await page.waitForTimeout(300)
let v = await stepVerdicts()
console.log('v2 自动运行结果：')
for (const [k, val] of Object.entries(v)) console.log(`  ${k} => ${val}`)

const assert = (cond, msg) => {
  if (!cond) { console.log('  ✗ FAIL:', msg); process.exitCode = 1 }
  else console.log('  ✓', msg)
}
assert(v['② 内容投影（slot）'] === 'loss', 'v2 slots = 静默丢失')
assert(v['⑤ 提交事件跨越 shadow 边界'] === 'loss', 'v2 events = 静默丢失')
assert(v['⑥ CSS ::part 样式暴露'] === 'loss', 'v2 parts = 静默丢失')
assert(v['① 挂载与注册'] === 'pass', 'v2 mount = 直接满足（组件能渲染）')

// 宿主事件记录应为空
const hostEv = await page.$eval('.panel-h:has-text("宿主事件接收记录") + .panel-b', el => el.textContent).catch(() => '')
assert(/还没有事件到达/.test(hostEv), 'v2 业务宿主零事件（提交按钮事件未到达宿主）')

// 展开 events 步骤验证解释文字
await expandStep(5)
const evActual = await actualText(5)
assert(evActual.includes('composed=false'), '事件解释包含 composed=false 机制')

// 内部派发回执应显示 composed false（元素现场面板）
const receipt = await page.$$eval('.probe-section', els => {
  const sec = els.find(e => e.textContent.includes('内部事件派发回执'))
  return sec ? sec.textContent : ''
})
assert(receipt.includes('false'), '探针回执含 composed=false')

// ── 场景二：切 v2+，六步应 adapted ──
await pickVersion('v2+')
await page.waitForTimeout(400)
await clickByText('button.btn', '自动运行全部')
await page.waitForFunction(() => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.trim() === '停止自动'), null, { timeout: 10000 })
await page.waitForTimeout(300)
v = await stepVerdicts()
console.log('v2+ 自动运行结果：')
for (const [k, val] of Object.entries(v)) console.log(`  ${k} => ${val}`)
assert(v['② 内容投影（slot）'] === 'adapted', 'v2+ slots = 兼容适配')
assert(v['⑤ 提交事件跨越 shadow 边界'] === 'adapted', 'v2+ events = 兼容适配')
assert(v['⑥ CSS ::part 样式暴露'] === 'adapted', 'v2+ parts = 兼容适配')
assert(v['③ 属性识别与回调'] === 'adapted', 'v2+ attributes = 兼容适配')
assert(v['④ Property 读写与属性反射'] === 'adapted', 'v2+ properties = 兼容适配')

const hostEv2 = await page.$eval('.panel-h:has-text("宿主事件接收记录") + .panel-b', el => el.textContent)
assert(/card-submit/.test(hostEv2) && /compat-alias/.test(hostEv2), 'v2+ 宿主收到 card-submit 且 detail 标注 compat-alias')

// ── 场景三：v1 全 pass ──
await pickVersion('v1')
await page.waitForTimeout(400)
await clickByText('button.btn', '自动运行全部')
await page.waitForFunction(() => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.trim() === '停止自动'), null, { timeout: 10000 })
await page.waitForTimeout(300)
v = await stepVerdicts()
assert(v['⑤ 提交事件跨越 shadow 边界'] === 'pass', 'v1 events = 直接满足')
assert(v['⑥ CSS ::part 样式暴露'] === 'pass', 'v1 parts = 直接满足')

// ── 场景四：v1 + composed 故障 → loss ──
await toggleFault('submit.composed=false')
await page.waitForTimeout(400)
await clickByText('button.btn', '自动运行全部')
await page.waitForFunction(() => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.trim() === '停止自动'), null, { timeout: 10000 })
await page.waitForTimeout(300)
v = await stepVerdicts()
assert(v['⑤ 提交事件跨越 shadow 边界'] === 'loss', 'v1+composed故障 events = 静默丢失')
await toggleFault('submit.composed=false')

// ── 场景五：stopPropagation → fail（点报告里第 5 步标题，重放到 events）──
await toggleFault('内部 stopPropagation')
await page.waitForTimeout(300)
await page.$$eval('[data-testid="report-panel"] .step .step-h', els => els[4]?.click())
await page.waitForTimeout(600)
v = await stepVerdicts()
assert(v['⑤ 提交事件跨越 shadow 边界'] === 'fail', 'stopPropagation events = 硬失败')
await toggleFault('内部 stopPropagation')

// ── 场景六：边界套件（v2+）──
await pickVersion('v2+')
await page.waitForTimeout(400)
await clickByText('button.btn', '跑边界套件（升级/重挂载/隔离）')
await page.waitForFunction(
  () => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.includes('套件执行中')),
  null, { timeout: 15000 }
)
await page.waitForTimeout(200)
const suitesBlock = await page.textContent('.grid > div:last-child')
assert(/升级边界/.test(suitesBlock), '套件：升级边界已运行')
assert(/重挂载/.test(suitesBlock), '套件：重挂载已运行')
assert(/多实例隔离/.test(suitesBlock), '套件：多实例隔离已运行')
assert(/未升级/.test(suitesBlock), '升级套件包含“未升级形态”断言')
const badges = await page.$$eval('.grid > div:last-child .v', els => els.map(e => e.textContent.trim()))
console.log('  套件总体结论：', badges.slice(0, 3).join(' | '))

// ── 场景七：撤销重做 ──
const verBefore = await page.$eval('.ver-selector button.on', el => el.textContent.trim())
await page.click('button.btn:has-text("撤销")')
await page.waitForTimeout(300)
const verUndo = await page.$eval('.ver-selector button.on', el => el.textContent.trim())
assert(verUndo !== verBefore, `撤销生效（${verBefore} → ${verUndo}）`)
await page.click('button.btn:has-text("重做")')
await page.waitForTimeout(300)
const verRedo = await page.$eval('.ver-selector button.on', el => el.textContent.trim())
assert(verRedo === verBefore, '重做生效回到 v2+')

// ── 场景八：刷新恢复 ──
await page.waitForTimeout(800)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.stale-banner', { timeout: 5000 })
const banner = await page.textContent('.stale-banner')
assert(/快照/.test(banner), '刷新后显示快照恢复横幅')
const staleSteps = await page.$$eval('.step.stale', els => els.length)
assert(staleSteps >= 1, `刷新后报告步骤带 stale/快照标记（${staleSteps} 个）`)

console.log('\n浏览器控制台错误：', errors.length ? errors : '无')
await browser.close()
console.log(process.exitCode ? '\n=== SMOKE FAILED ===' : '\n=== SMOKE PASSED ===')
