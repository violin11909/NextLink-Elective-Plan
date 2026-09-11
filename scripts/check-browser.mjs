import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';

const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', (data) => { logs += data; }); server.stderr.on('data', (data) => { logs += data; });
let browser;
const results = [];
const errors = [], failedAssets = [];
const key = 'nextlink.plan.v3.2569-1';
const courseId = 'plan-21105801';
await mkdir('output/browser', { recursive: true });
const check = async (name, fn) => { await fn(); results.push(name); console.log('  ✓ ' + name); };
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'production server started');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.url().includes('/_next/') && response.status() >= 400) failedAssets.push(`${response.status()} ${response.url()}`); });
    page.on('dialog', (dialog) => dialog.accept());
  };
  const page = await context.newPage(); watch(page);
  const go = async (path) => { await page.goto(base + path); await page.getByRole('button', { name: 'สำรองแผน JSON', exact: true }).waitFor(); };
  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const seed = async (document) => { await page.evaluate(({ key, document }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(document)); }, { key, document }); };
  await go('/');
  await check('standalone hydrates and loads its scheduler worker', async () => {
    await page.getByRole('button', { name: 'จัดตารางอัตโนมัติ', exact: true }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').assignments?.length > 0, key);
    assert.ok((await read()).assignments.length > 0);
    assert.deepEqual(failedAssets, []);
  });
  const scheduled = await read();
  await check('duplicate session move is refused without changing ids', async () => {
    const title = 'System Design for Software Development';
    const cards = page.locator('.matrix-chip').filter({ hasText: title });
    await cards.first().click(); await cards.nth(1).click();
    await page.getByRole('region', { name: 'การบันทึกแผน' }).getByText('วิชานี้มีคาบในช่วงปลายทางแล้ว กรุณาเลือกคาบอื่น', { exact: true }).waitFor();
    assert.deepEqual((await read()).assignments, scheduled.assignments);
  });
  await go('/');
  await check('onsite course cannot be moved into the online column', async () => {
    const title = 'SW Dev for CMMI Standard';
    const item = scheduled.assignments.find((item) => item.courseId === courseId);
    const days = { MON: 'จันทร์', TUE: 'อังคาร', WED: 'พุธ', THU: 'พฤหัสบดี', FRI: 'ศุกร์', SAT: 'เสาร์' };
    const periods = { AM: 'เช้า', PM: 'บ่าย', EVE: 'เย็น' };
    const [day, period] = item.slotId.split('_');
    await page.locator('.matrix-chip').filter({ hasText: title }).click();
    await page.getByRole('button', { name: `วาง ${title} ที่ ออนไลน์ ${days[day]}${periods[period]}`, exact: true }).click();
    await page.getByRole('region', { name: 'การบันทึกแผน' }).getByText('วิชาในห้องเรียนหรือไฮบริดต้องมีห้องเรียน กรุณาเลือกคอลัมน์ห้อง', { exact: true }).waitFor();
    assert.deepEqual((await read()).assignments, scheduled.assignments);
  });
  await check('invalid URL filters are sanitized without crashing', async () => {
    await go('/courses/list?day=SUNDAY&period=INVALID');
    await page.locator('tbody tr').first().waitFor();
    assert.equal(new URL(page.url()).searchParams.has('period'), false);
    assert.equal(new URL(page.url()).searchParams.has('day'), false);
    assert.equal(await page.getByRole('heading', { name: 'โหลดข้อมูลไม่สำเร็จ' }).count(), 0);
    await go('/courses?period=INVALID');
    await page.getByRole('heading', { name: 'วิชาและช่วงที่สะดวก', exact: true }).waitFor();
  });
  await check('Back and Forward restore both URL filters and visible controls', async () => {
    await go('/courses/list?day=MON&period=AM');
    await page.getByRole('combobox', { name: /วันที่สะดวก/ }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: /วันที่สะดวก/ }).inputValue(), 'MON');
    await page.evaluate(() => { history.pushState(history.state, '', '?day=TUE&period=PM'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForFunction(() => location.search.includes('day=TUE'));
    assert.equal(await page.getByRole('combobox', { name: /คาบที่สะดวก/ }).inputValue(), 'PM');
    await page.goBack();
    await page.waitForFunction(() => location.search.includes('day=MON'));
    assert.equal(await page.getByRole('combobox', { name: /วันที่สะดวก/ }).inputValue(), 'MON');
    assert.equal(await page.getByRole('combobox', { name: /คาบที่สะดวก/ }).inputValue(), 'AM');
    await page.goForward();
    await page.waitForFunction(() => location.search.includes('day=TUE'));
    assert.equal(await page.getByRole('combobox', { name: /วันที่สะดวก/ }).inputValue(), 'TUE');
  });
  await check('legacy onsite sessions without rooms are labelled honestly in UI and Excel', async () => {
    await seed({ ...scheduled, assignments: scheduled.assignments.map((item) => item.courseId === courseId ? { ...item, roomId: null } : item) });
    await go('/courses/list?q=SW%20Dev%20for%20CMMI%20Standard');
    await page.locator('.room-tag').getByText('ยังไม่มีห้อง', { exact: true }).waitFor();
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
    await (await pending).saveAs('output/browser/missing-room.xlsx');
    assert.ok((await readFile('output/browser/missing-room.xlsx')).toString().includes('ยังไม่มีห้อง'));
  });
  const blank = { ...scheduled, assignments: [], checklists: {}, revision: 0, editedAt: null };
  await seed(blank);
  await check('checklist ignores hidden placement filter and exports all matching rows', async () => {
    await go('/courses/list?placement=placed&view=checklist');
    await page.locator('select.checklist-select').first().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 10);
    assert.equal(new URL(page.url()).searchParams.has('placement'), false);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
    const file = await download; await file.saveAs('output/browser/checklist.xlsx');
    const bytes = await readFile('output/browser/checklist.xlsx');
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.ok(bytes.toString().includes('SW Dev for CMMI Standard'));
  });
  await check('two tabs preserve each other\'s edits and update their visible fields', async () => {
    const other = await context.newPage(); watch(other); await other.goto(base + '/courses/list?view=checklist');
    await other.locator('select.checklist-select').first().waitFor();
    await Promise.all([
      page.locator('tbody tr').first().locator('select.checklist-select').nth(0).selectOption('RECEIVED'),
      other.locator('tbody tr').first().locator('select.checklist-select').nth(1).selectOption('RECEIVED'),
    ]);
    await page.waitForFunction((key) => { const c = JSON.parse(localStorage.getItem(key)).checklists['plan-21105801']; return c?.invitationLetter === 'RECEIVED' && c?.teachingHoursLetter === 'RECEIVED'; }, key);
    await page.waitForFunction(() => document.querySelectorAll('tbody tr:first-child select')[1]?.value === 'RECEIVED');
    await other.waitForFunction(() => document.querySelector('tbody tr:first-child select')?.value === 'RECEIVED');
    await other.close();
  });
  await check('MCV code remains editable until blur while incomplete filter is active', async () => {
    const completedExceptCode = { invitationLetter: 'RECEIVED', teachingHoursLetter: 'RECEIVED', mcvInstructorRequest: 'DONE', mentorAdded: 'DONE', guestLecturerAdded: 'DONE', studentsAdded: 'DONE', mcvJoinCode: '' };
    await seed({ ...blank, checklists: { [courseId]: completedExceptCode } });
    await go('/courses/list?view=checklist&done=incomplete');
    const code = page.getByRole('textbox', { name: 'รหัส Join MCV สำหรับนิสิต — SW Dev for CMMI Standard', exact: true });
    await code.pressSequentially('ABC123', { delay: 30 });
    assert.equal(await code.inputValue(), 'ABC123');
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).checklists['plan-21105801']?.mcvJoinCode === 'ABC123', key);
    await code.press('Tab');
    await code.waitFor({ state: 'detached' });
    await page.reload();
    assert.equal((await read()).checklists[courseId].mcvJoinCode, 'ABC123');
  });
  await check('quota failure shows unsaved status and backup; retry saves the retained draft', async () => {
    await seed(blank); await go('/');
    await page.evaluate(() => { globalThis.restoreStorage = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('Simulated quota', 'QuotaExceededError'); }; });
    await page.getByRole('button', { name: 'จัดตารางอัตโนมัติ', exact: true }).click();
    await page.getByText('แผนยังบันทึกไม่สำเร็จ', { exact: false }).waitFor();
    assert.equal((await read()).assignments.length, 0);
    assert.ok(await page.locator('.matrix-chip').count() > 0);
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'สำรองแผน JSON', exact: true }).click();
    await (await pending).saveAs('output/browser/unsaved-plan.json');
    assert.ok(JSON.parse(await readFile('output/browser/unsaved-plan.json', 'utf8')).assignments.length > 0);
    await page.evaluate(() => { Storage.prototype.setItem = globalThis.restoreStorage; });
    await page.getByRole('button', { name: 'ลองบันทึกอีกครั้ง', exact: true }).click();
    await page.getByText('บันทึกแล้วในเบราว์เซอร์นี้', { exact: false }).waitFor();
    assert.ok((await read()).assignments.length > 0);
  });
  await check('corrupt storage can be backed up and recovered from the page', async () => {
    await page.evaluate((key) => localStorage.setItem(key, '{ corrupted'), key); await page.reload();
    await page.getByRole('button', { name: 'สำรองและเริ่มแผนใหม่', exact: true }).waitFor();
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'สำรองและเริ่มแผนใหม่', exact: true }).click();
    await (await pending).saveAs('output/browser/corrupt-plan.json');
    assert.equal(await readFile('output/browser/corrupt-plan.json', 'utf8'), '{ corrupted');
    await page.getByRole('button', { name: 'จัดตารางอัตโนมัติ', exact: true }).waitFor();
    assert.deepEqual((await read()).assignments, []);
  });
  await check('deleting a room from detail can be undone after client navigation', async () => {
    await seed(scheduled); const target = scheduled.assignments.find((item) => item.roomId);
    await go('/rooms/' + target.roomId);
    await page.getByRole('button', { name: 'แก้ไขห้องนี้', exact: true }).click();
    await page.getByRole('button', { name: 'ลบห้องนี้', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันลบ', exact: true }).click();
    await page.waitForURL(base + '/rooms');
    assert.equal((await read()).assignments.some((item) => item.roomId === target.roomId), false);
    const undo = page.getByRole('button', { name: 'เลิกทำรายการล่าสุด', exact: true });
    await undo.click();
    await page.waitForFunction(({ key, roomId }) => JSON.parse(localStorage.getItem(key)).assignments.some((item) => item.roomId === roomId), { key, roomId: target.roomId });
    assert.deepEqual((await read()).assignments, scheduled.assignments);
  });
  await check('worker cancellation keeps the prior plan intact', async () => {
    await go('/');
    const before = await read();
    await page.evaluate(() => {
      const Original = Worker;
      globalThis.Worker = class extends Original { postMessage(...args) { setTimeout(() => super.postMessage(...args), 1500); } };
    });
    await page.getByRole('button', { name: 'จัดตารางอัตโนมัติ', exact: true }).click();
    await page.getByRole('button', { name: 'ยกเลิกการจัดตาราง', exact: true }).click();
    await page.getByRole('region', { name: 'การบันทึกแผน' }).getByText('ยกเลิกการจัดตารางแล้ว แผนเดิมยังอยู่', { exact: true }).waitFor();
    assert.deepEqual(await read(), before);
    await page.reload();
  });
  await check('valid backup import and reset can both be undone', async () => {
    await go('/courses/list?view=checklist');
    const before = await read();
    const imported = { ...before, checklists: { [courseId]: { mcvJoinCode: 'IMPORTED' } } };
    await page.locator('input[type=file]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).checklists['plan-21105801']?.mcvJoinCode === 'IMPORTED', key);
    await page.getByRole('button', { name: 'เลิกทำรายการล่าสุด', exact: true }).click();
    await page.waitForFunction((key) => !JSON.parse(localStorage.getItem(key)).checklists['plan-21105801']?.mcvJoinCode, key);
    assert.deepEqual((await read()).assignments, before.assignments);
    await page.getByRole('button', { name: 'คืนค่าเริ่มต้น', exact: true }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).assignments.length === 0, key);
    await page.getByRole('button', { name: 'เลิกทำรายการล่าสุด', exact: true }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).assignments.length > 0, key);
    assert.deepEqual((await read()).assignments, before.assignments);
  });
  await check('archive export, mobile layout and all production assets remain usable', async () => {
    await go('/courses/list?term=2568-2');
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
    await (await pending).saveAs('output/browser/archive.xlsx');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/browser/mobile.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.setViewportSize({ width: 1440, height: 1000 }); await go('/');
    await page.screenshot({ path: 'output/browser/overview.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
  });
  await writeFile('output/browser/results.json', JSON.stringify({ passed: results.length, results, errors, failedAssets }, null, 2));
  await rm('output/browser/failure.json', { force: true });
  console.log(`browser: ok (${results.length} production regression checks)`);
} catch (error) {
  await writeFile('output/browser/failure.json', JSON.stringify({ results, error: String(error), errors, failedAssets, logs }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
