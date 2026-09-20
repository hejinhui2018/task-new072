// 真实浏览器冒烟验收：启动 preview，驱动 UI，读取真实 Shadow DOM 探测结论
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4317';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEP_TITLES = ['投影', '反射', '事件', 'parts', '重挂载', '多实例', '升级'];

function verdicts() {
  const items = [...document.querySelectorAll('.step-item')];
  return items.map((it) => {
    const badge = it.querySelector('.step-actions .badge')?.textContent.trim() || '未执行';
    return badge;
  });
}

async function runAll(page) {
  await page.getByRole('button', { name: '自动运行' }).click();
  // 7 步 × 650ms + 余量
  await page.waitForFunction(
    () => [...document.querySelectorAll('.step-item')].every((it) => {
      const t = it.querySelector('.step-actions .badge')?.textContent.trim();
      return t && t !== '未执行';
    }),
    null,
    { timeout: 15000 },
  );
  await sleep(200);
}

const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) {
    console.log('   expected:', JSON.stringify(expected));
    console.log('   actual:  ', JSON.stringify(actual));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE);
await page.waitForSelector('.stage-wrap order-form-v2, .stage-wrap order-form-v1', { timeout: 10000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.stage-wrap order-form-v2');

// 场景 1：v1 对照组 —— 七步全绿
await page.getByRole('button', { name: /v1 旧版/ }).click();
await runAll(page);
let v = await page.evaluate(verdicts);
check('v1 无适配对照组：7 步全部通过', v, ['通过', '通过', '通过', '通过', '通过', '通过', '通过']);

// 场景 2：v2 无适配 —— 四处静默丢失 + 生命周期仍通过
await page.getByRole('button', { name: /v2 新版/ }).click();
await runAll(page);
v = await page.evaluate(verdicts);
check('v2 无适配：投影/反射/事件/parts/升级 静默丢失，重挂载与多实例通过', v, [
  '静默丢失', '静默丢失', '静默丢失', '静默丢失', '通过', '通过', '静默丢失',
]);

// 场景 3：v2 + 适配层 —— 四处变兼容适配
await page.locator('.toolgroup input[type=checkbox]').check();
await runAll(page);
v = await page.evaluate(verdicts);
check('v2 + 适配层：四处差异变为兼容适配，生命周期通过', v, [
  '兼容适配', '兼容适配', '兼容适配', '兼容适配', '通过', '通过', '兼容适配',
]);

// 场景 4：v2 + 适配层 + drop-submit —— 事件步骤必须 fail（适配救不了组件不发事件）
await page.getByText('丢弃提交事件').locator('xpath=ancestor::label').locator('input').check();
await runAll(page);
v = await page.evaluate(verdicts);
check('v2 + 适配 + drop-submit：事件/升级 fail，但重挂载与多实例隔离本身仍成立', v, [
  '兼容适配', '兼容适配', '故障', '兼容适配', '通过', '通过', '故障',
]);
await page.getByText('丢弃提交事件').locator('xpath=ancestor::label').locator('input').uncheck();

// 场景 5：force-non-composed 同样不可被宿主适配补救
await page.getByText('事件不 composed').locator('xpath=ancestor::label').locator('input').check();
await runAll(page);
v = await page.evaluate(verdicts);
check('v2 + 适配 + non-composed：事件步骤 fail', v[2], '故障');
await page.getByText('事件不 composed').locator('xpath=ancestor::label').locator('input').uncheck();

// 场景 6：strip-parts 时垫片在但无效
await page.getByText('剥离 CSS parts').locator('xpath=ancestor::label').locator('input').check();
await runAll(page);
v = await page.evaluate(verdicts);
check('v2 + 适配 + strip-parts：parts 步骤 fail（垫片无选择器可命中）', v[3], '故障');
await page.getByText('剥离 CSS parts').locator('xpath=ancestor::label').locator('input').uncheck();

// 场景 7：刷新恢复 —— 先在 v1 跑三步，刷新后应出现“已重放”
await page.locator('.toolgroup input[type=checkbox]').uncheck();
await page.getByRole('button', { name: /v1 旧版/ }).click();
for (const i of [0, 1, 2]) {
  await page.locator('.step-item').nth(i).getByRole('button', { name: '单步执行' }).click();
  await sleep(120);
}
const stored = await page.evaluate(() => localStorage.getItem('slot-contract-harness:v1'));
const parsed = JSON.parse(stored);
check('持久化仅保存配置 + 已执行步骤下标', [parsed.version, parsed.compat, parsed.executed], ['v1', false, [0, 1, 2]]);
await page.reload();
await page.waitForSelector('.stage-wrap order-form-v1');
await page.waitForFunction(
  () => [...document.querySelectorAll('.step-item')].slice(0, 3).every((it) =>
    it.querySelector('.step-actions .badge')?.textContent.trim() === '已重放'),
  null,
  { timeout: 8000 },
);
const restored = await page.evaluate(() =>
  [...document.querySelectorAll('.step-item')].slice(0, 3).map((it) =>
    it.querySelector('.step-actions .badge')?.textContent.trim()));
check('刷新后在全新真实 DOM 上重放，标记为已重放', restored, ['已重放', '已重放', '已重放']);

// 场景 8：重置清空持久化与结论
await page.getByRole('button', { name: '重置' }).click();
await sleep(100);
const afterReset = await page.evaluate(() => ({
  storage: localStorage.getItem('slot-contract-harness:v1'),
  badges: [...document.querySelectorAll('.step-actions .badge')].map((b) => b.textContent.trim()),
}));
check('重置：localStorage 清空且结论全部回到未执行', afterReset, {
  storage: null,
  badges: Array(7).fill('未执行'),
});

// 场景 9：舞台真实存在 open shadow root 且宿主按钮可点
const dom = await page.evaluate(() => {
  const ce = document.querySelector('.stage-wrap order-form-v1');
  const root = ce?.shadowRoot;
  const internalBtn = root?.querySelector('button.submit')?.textContent.trim();
  const slots = [...(root?.querySelectorAll('slot') ?? [])].map((s) => ({
    name: s.name || 'default',
    assigned: s.assignedNodes().length,
  }));
  return { hasRoot: !!root, mode: root?.mode ?? null, internalBtn, slots };
});
check('舞台：open shadow root、内部提交按钮、slot 分配真实存在', dom, {
  hasRoot: true,
  mode: 'open',
  internalBtn: '提交订单',
  slots: [{ name: 'default', assigned: 1 }, { name: 'actions', assigned: 1 }],
});

check('无未捕获的页面错误', errors.length === 0 ? [] : errors, []);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项冒烟验收通过`);
process.exit(failed.length ? 1 : 0);
