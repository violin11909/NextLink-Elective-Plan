import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlanStore } from '../lib/plan-store.ts';
import { decodePlan, emptyDocument, LEGACY_STORAGE_KEY, storageKeyFor } from '../lib/plan-document.ts';
const courses = JSON.parse(readFileSync('data/plan-courses.json', 'utf8'));
const rooms = JSON.parse(readFileSync('data/plan-rooms.json', 'utf8'));
const payload = { ...courses, rooms: rooms.rooms, term: { id: '2569-1' }, seedRevision: 'test' };
const id = payload.courses[0].id;
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('  ✓ ' + name); }
function disk() {
  const values = new Map(); let queue = Promise.resolve();
  return {
    values, fail: false,
    read(key) { return values.get(key) ?? null; },
    write(key, value) { if (this.fail) throw new Error('QuotaExceededError'); values.set(key, value); },
    exclusive(_key, work) { const next = queue.then(work); queue = next.catch(() => {}); return next; },
  };
}
const patch = (field, value) => (current) => ({ ...current, checklists: { ...current.checklists, [id]: { ...current.checklists[id], [field]: value } } });
await check('two stale tabs merge concurrent field edits under a shared lock', async () => {
  const persistence = disk(); const a = new PlanStore(payload, persistence), b = new PlanStore(payload, persistence);
  a.load(); b.load();
  assert.deepEqual(await Promise.all([a.mutate(patch('mentorAdded', 'DONE')), b.mutate(patch('studentsAdded', 'DONE'))]), [true, true]);
  a.refresh();
  assert.equal(a.getSnapshot().document.checklists[id].mentorAdded, 'DONE');
  assert.equal(a.getSnapshot().document.checklists[id].studentsAdded, 'DONE');
  assert.equal(a.getSnapshot().document.revision, 2);
  assert.equal(a.getSnapshot().canUndo, false);
});
await check('quota failure keeps a recoverable draft and retry persists it', async () => {
  const persistence = disk(); const store = new PlanStore(payload, persistence); store.load(); persistence.fail = true;
  assert.equal(await store.mutate(patch('mcvJoinCode', 'ABC123')), false);
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().document.checklists[id].mcvJoinCode, 'ABC123');
  assert.equal(persistence.values.size, 0);
  store.refresh(); assert.equal(store.getSnapshot().document.checklists[id].mcvJoinCode, 'ABC123');
  persistence.fail = false; assert.equal(await store.retry(), true);
  assert.equal(decodePlan(persistence.read(store.key), payload).document.checklists[id].mcvJoinCode, 'ABC123');
});
await check('unsaved draft cannot overwrite a later change from another tab', async () => {
  const persistence = disk(); const a = new PlanStore(payload, persistence), b = new PlanStore(payload, persistence); a.load(); b.load();
  persistence.fail = true; await a.mutate(patch('mcvJoinCode', 'LOCAL'));
  persistence.fail = false; await b.mutate(patch('mcvJoinCode', 'REMOTE'));
  assert.equal(await a.retry(), false);
  assert.equal(a.getSnapshot().document.checklists[id].mcvJoinCode, 'LOCAL');
  assert.equal(decodePlan(persistence.read(a.key), payload).document.checklists[id].mcvJoinCode, 'REMOTE');
});
await check('malformed storage is quarantined and original bytes are recoverable', async () => {
  const persistence = disk(); persistence.values.set(storageKeyFor(payload.term.id), '{ broken');
  const store = new PlanStore(payload, persistence); store.load();
  assert.equal(store.getSnapshot().ready, true); assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().recoveryRaw, '{ broken');
  assert.equal(await store.mutate(patch('mcvJoinCode', 'NO')), false);
  assert.equal(persistence.read(store.key), '{ broken');
  assert.equal(await store.recoverEmpty(), true);
  assert.deepEqual(store.getSnapshot().document.assignments, []);
});
await check('invalid candidate never replaces a valid visible document', async () => {
  const persistence = disk(); const store = new PlanStore(payload, persistence); store.load();
  assert.equal(await store.mutate((current) => ({ ...current, assignments: [{ id: 'bad' }] })), false);
  assert.deepEqual(store.getSnapshot().document.assignments, []);
  assert.equal(persistence.values.size, 0);
});
await check('legacy migration preserves edits and isolates terms', async () => {
  const persistence = disk(); persistence.values.set(LEGACY_STORAGE_KEY, JSON.stringify({ version: 1, assignments: [], courseOverrides: {}, checklists: { [id]: { mcvJoinCode: 'OLD' } } }));
  const store = new PlanStore(payload, persistence); store.load();
  assert.equal(store.getSnapshot().document.checklists[id].mcvJoinCode, 'OLD');
  await store.mutate(patch('mentorAdded', 'DONE'));
  assert.equal(JSON.parse(persistence.read(store.key)).version, 3);
  assert.ok(persistence.read(LEGACY_STORAGE_KEY));
  const nextTerm = new PlanStore({ ...payload, term: { id: '2569-2' } }, persistence); nextTerm.load();
  assert.deepEqual(nextTerm.getSnapshot().document.checklists, {});
  assert.throws(() => decodePlan(persistence.read(store.key), { ...payload, term: { id: '2569-2' } }));
});
await check('undo survives consumer changes and refuses stale undo after another tab writes', async () => {
  const persistence = disk(); const a = new PlanStore(payload, persistence), b = new PlanStore(payload, persistence); a.load(); b.load();
  await a.mutate(patch('mcvJoinCode', 'FIRST')); const consume = () => a.getSnapshot(); assert.equal(consume().canUndo, true);
  assert.equal(await a.undo(), true); assert.deepEqual(a.getSnapshot().document.checklists, {});
  await a.mutate(patch('mcvJoinCode', 'SECOND')); await b.mutate(patch('studentsAdded', 'DONE'));
  assert.equal(await a.undo(), false);
  assert.equal(decodePlan(persistence.read(a.key), payload).document.checklists[id].studentsAdded, 'DONE');
});
await check('schema rejects duplicate sessions, invalid overrides and unknown room references', async () => {
  const base = emptyDocument(payload);
  for (const edits of [{ courseOverrides: { [id]: { availability: 'MON_AM' } } }, { roomEdits: { overrides: {}, added: [null], removed: [] } }, { assignments: [null] }, { version: '3' }]) {
    assert.throws(() => decodePlan(JSON.stringify({ ...base, ...edits }), payload));
  }
});
console.log(`${checks} storage regression checks passed`);
