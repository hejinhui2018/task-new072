import { chromium } from '@playwright/test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage();
const out = [];
const ok = (n, cond, extra = '') => out.push({ n, pass: !!cond, extra });

await page.goto('http://127.0.0.1:4317');
await page.waitForSelector('.stage-wrap order-form-v2');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.stage-wrap order-form-v2');

const badges = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.step-item')].map((it) =>
      it.querySelector('.step-actions .badge')?.textContent.trim()));

async function runAll() {
  await page.getByRole('button', { name: '自动运行' }).click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('.step-item')].every((it) => {
      const t = it.querySelector('.step-actions .badge')?.textContent.trim();
      return t && t !== '未执行';
    }),
    null, { timeout: 15000 });
  await sleep(150);
}

// swallow-slots + 适配：步骤 1 必须是静默丢失（适配改名正确，但组件不声明槽）
await page.locator('.toolgroup input[type=checkbox]').check();
await page.getByText('不声明具名 slot').locator('xpath=ancestor::label').locator('input').check();
await runAll();
let b = await badges();
ok('swallow-slots+适配：投影步骤 fail/loss（组件未声明槽，宿主适配无效）', b[0] === '故障' || b[0] === '静默丢失', b[0]);
await page.getByText('不声明具名 slot').locator('xpath=ancestor::label').locator('input').uncheck();

// block-reflection：反射步骤 fail（v2 适配也无法补 property→attribute 回写）
await page.getByText('切断 property 反射').locator('xpath=ancestor::label').locator('input').check();
await runAll();
b = await badges();
ok('block-reflection+适配：反射步骤 fail（property 写入静默不回写）', b[1] === '故障', b[1]);
await page.getByText('切断 property 反射').locator('xpath=ancestor::label').locator('input').uncheck();
await page.locator('.toolgroup input[type=checkbox]').uncheck();

// 撤销/重做：跑 2 步 -> undo 第 2 步结果消失 -> redo 回来
await page.getByRole('button', { name: /v1 旧版/ }).click();
await page.locator('.step-item').nth(0).getByRole('button', { name: '单步执行' }).click();
await sleep(80);
await page.locator('.step-item').nth(1).getByRole('button', { name: '单步执行' }).click();
await sleep(80);
b = await badges();
ok('执行 2 步后前两项有结论', b[0] !== '未执行' && b[1] !== '未执行', b.slice(0, 2).join(','));
await page.getByRole('button', { name: '撤销' }).click();
await sleep(80);
b = await badges();
ok('撤销：第 2 步结论回退', b[1] === '未执行' && b[0] !== '未执行', b.slice(0, 2).join(','));
await page.getByRole('button', { name: '重做' }).click();
await sleep(80);
b = await badges();
ok('重做：第 2 步结论恢复', b[0] !== '未执行' && b[1] !== '未执行', b.slice(0, 2).join(','));

// 舞台活按钮直点：直接点 shadow 内部提交按钮，宿主日志区/组件本身不报错且产生交互
const clickResult = await page.evaluate(() => {
  const ce = document.querySelector('.stage-wrap order-form-v1');
  let received = null;
  ce.addEventListener('form-submit', (e) => { received = e.detail; }, { once: true });
  ce.shadowRoot.querySelector('button.submit').click();
  return received;
});
ok('舞台直点内部提交按钮：form-submit 真实到达宿主节点并携带 detail',
  clickResult && clickResult.orderId === 'ORD-2048', JSON.stringify(clickResult));

// 自动运行可中途停止
await page.getByRole('button', { name: '重置' }).click();
await sleep(80);
await page.getByRole('button', { name: '自动运行' }).click();
await sleep(300);
await page.getByRole('button', { name: '停止' }).click();
await sleep(900);
b = await badges();
const executed = b.filter((x) => x !== '未执行').length;
ok('自动运行可中途停止（执行数在 1~6 之间）', executed >= 1 && executed < 7, `executed=${executed}`);

let pass = 0;
for (const r of out) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.n}${r.pass && r.extra ? ` [${r.extra}]` : r.extra ? ` got=${r.extra}` : ''}`);
  if (r.pass) pass++;
}
console.log(`\n${pass}/${out.length} 边界验证通过`);
await browser.close();
process.exit(pass === out.length ? 0 : 1);
