import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateArchiveSessions, assertSeedNumber } from '../lib/seed-validation.ts';
const course = { id: 'a', instructor: 'teacher', deliveryMode: 'ON_SITE' };
const session = { courseId: 'a', slotId: 'MON_AM', roomName: 'room' };
validateArchiveSessions([course], [session]);
assert.throws(() => validateArchiveSessions([course], [session, session]));
assert.throws(() => validateArchiveSessions([course, { ...course, id: 'b' }], [session, { ...session, courseId: 'b' }]));
assert.throws(() => validateArchiveSessions([course], [{ ...session, roomName: null }]));
assert.throws(() => validateArchiveSessions([{ ...course, deliveryMode: 'ONLINE' }], [session]));
assert.throws(() => assertSeedNumber('seats', -1, 1, 2000));
assert.throws(() => assertSeedNumber('seats', 2.5, 1, 2000));
for (const id of ['2568-2', '2568-1', '2567-2']) {
  const archive = JSON.parse(readFileSync(`data/terms/${id}.json`, 'utf8'));
  validateArchiveSessions(archive.courses, archive.sessions);
}
console.log('seed/archive consistency: ok (7 checks, 3 bundled archives)');
