// 故障矩阵 + 现场交互 + 截图
import { chromium } from 'playwright-core'

const SHELL = process.env.HEADLESS_SHELL || '/tmp/pw-browsers/chromium_headless_shell-1187/chrome-linux/headless_shell'
const browser = await chromium.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1680,1050'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/syslib/usr/lib/x86_64-linux-gnu:/tmp/syslib/lib/x86_64-linux-gnu' },
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.app-header')

async function runAll() {
  await page.click('button.btn:has-text("自动运行全部")')
  await page.waitForFunction(
    () => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.trim() === '停止自动'),
    null, { timeout: 10000 })
  await page.waitForTimeout(200)
}
async function verdicts() {
  const steps = await page.$$('[data-testid="report-panel"] .step')
  const out = []
  for (const s of steps) out.push(await s.$eval('.v', el => el.textContent.trim()))
  return out
}
async function set(version, faultLabel) {
  await page.click(`.ver-selector button:has-text("${version}")`)
  await page.waitForTimeout(150)
  if (faultLabel) { await page.click(`label.chip:has-text("${faultLabel}")`); await page.waitForTimeout(150) }
  await runAll()
}
async function clearFault(label) { await page.click(`label.chip:has-text("${label}")`); await page.waitForTimeout(150) }

const [M, S, A, P, E, Pa] = ['mount','slots','attrs','props','events','parts']
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(ok ? '✓' : '✗', label, ok ? '' : `\n   got=${JSON.stringify(actual)}\n   want=${JSON.stringify(wanted)}`)
  if (!ok) process.exitCode = 1
}

// v2+ 基线
await set('v2+', null)
expect('v2+ 基线', await verdicts(), ['pass','adapted','adapted','adapted','adapted','adapted'])

// v2+ + 每个故障：相关步骤应从 adapted 翻成 loss/fail
await set('v2+', 'header 槽位缺失')
expect('v2+ dropHeaderSlot: slots→loss', (await verdicts())[1], 'loss')
await clearFault('header 槽位缺失')

await set('v2+', '隐藏 submit part')
expect('v2+ hideSubmitPart: parts→loss', (await verdicts())[5], 'loss')
await clearFault('隐藏 submit part')

await set('v2+', 'property 不反射')
expect('v2+ noAttrReflect: props→loss', (await verdicts())[3], 'loss')
await clearFault('property 不反射')

await set('v2+', '内部 stopPropagation')
expect('v2+ stopProp: events→fail', (await verdicts())[4], 'fail')
await clearFault('内部 stopPropagation')

await set('v2+', 'closed ShadowRoot')
const vsClosed = await verdicts()
expect('v2+ closed: mount=adapted 其余仍成立', [vsClosed[0], vsClosed[4], vsClosed[5]], ['adapted','adapted','adapted'])
await clearFault('closed ShadowRoot')

// v1 各故障
await set('v1', 'header 槽位缺失')
expect('v1 dropHeaderSlot: slots→loss', (await verdicts())[1], 'loss')
await clearFault('header 槽位缺失')

await set('v1', '多实例共享状态')
// 六步本身不直接报隔离问题，但属性/挂载仍 pass；隔离由套件检验。这里只确认不崩溃
expect('v1 sharedState 不崩溃', (await verdicts())[0], 'pass')
// 跑套件验证隔离 loss
await page.click('button.btn:has-text("跑边界套件")')
await page.waitForFunction(() => !Array.from(document.querySelectorAll('button.btn')).some(b => b.textContent.includes('套件执行中')), null, { timeout: 15000 })
const isoText = await page.$$eval('.suite-case', els => els.filter(e => /property 实例私有|不继承旧实例状态/.test(e.textContent)).map(e => e.textContent).join('\n'))
console.log(/故障 sharedState/.test(isoText) ? '✓ 套件捕获 sharedState 串数据' : '✗ 套件未捕获 sharedState\n' + isoText)
if (!/故障 sharedState/.test(isoText)) process.exitCode = 1
await clearFault('多实例共享状态')

// 现场交互：直接点真实元素的提交按钮，宿主事件记录应实时增加（v1）
await set('v1', null)
const before = await page.$eval('.panel-h:has-text("宿主事件接收记录") .pill', el => Number(el.textContent)).catch(() => 0)
await page.click('.business-host button')
await page.waitForTimeout(200)
const after = await page.$eval('.panel-h:has-text("宿主事件接收记录") .pill', el => Number(el.textContent))
console.log(after === before + 1 ? `✓ 真实点击 shadow 按钮 → 宿主实时收到（${before}→${after}）` : `✗ 实时点击计数 ${before}→${after}`)
if (after !== before + 1) process.exitCode = 1

// 截图：v2 默认视图（最有代表性的故障现场）
await page.click(`.ver-selector button:has-text("v2")`)
await page.waitForTimeout(300)
await runAll()
// 展开事件步骤
await page.$$eval('[data-testid="report-panel"] .step .step-h', els => els[4]?.click())
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/shot-v2.png', fullPage: false })

// v2+ 截图
await page.click(`.ver-selector button:has-text("v2+")`)
await page.waitForTimeout(300)
await runAll()
await page.$$eval('[data-testid="report-panel"] .step .step-h', els => els[4]?.click())
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/shot-v2plus.png', fullPage: false })

console.log('页面错误：', errors.length ? errors : '无')
await browser.close()
console.log(process.exitCode ? '=== MATRIX FAILED ===' : '=== MATRIX PASSED ===')
