import assert from 'node:assert/strict';
import { planSchedule, placementBlockers } from '../lib/scheduler.ts';
import { detectConflicts } from '../lib/conflicts.ts';
import { moveAssignment, placeAssignment, changeAssignmentTime } from '../lib/assignments.ts';

const course=(id,patch={})=>({id,courseCode:id,title:id,category:'test',provider:id,instructor:id,coordinator:null,deliveryMode:'ON_SITE',availability:['MON_AM','TUE_AM'],sessionsPerWeek:1,minSeats:20,capacity:20,weeks:10,notes:null,...patch});
const room=(id,seats=60,tier='READY')=>({id,name:id,building:id,floor:'1',seats,tier,seatsIsEstimated:false,blockedSlots:[]});
const assignment=(courseId,slotId='MON_AM',roomId='r1',patch={})=>({id:courseId+'@'+slotId,courseId,slotId,roomId,startTime:'09:00',endTime:'12:00',locked:false,source:'MANUAL',...patch});
let checks=0;
function check(name,fn){fn(); checks++; console.log('  ✓ '+name);}

check('fallback returns relocated first-pass sessions without teacher conflicts',()=>{
 const courses=[course('A',{instructor:'same'}),course('B',{instructor:'same',availability:['MON_AM'],minSeats:80,capacity:80})];
 const rooms=[room('r1'),room('r2',100,'NEEDS_APPROVAL')];
 const result=planSchedule({courses,rooms});
 assert.equal(result.unassigned.length,0);
 assert.equal(result.assignments.find(a=>a.courseId==='A').slotId,'TUE_AM');
 assert.equal(detectConflicts({...result,courses,rooms}).filter(c=>c.severity==='BLOCKED').length,0);
});
check('fallback preserves user locks and never duplicates them',()=>{
 const courses=[course('A'),course('B',{minSeats:80,capacity:80})];
 const rooms=[room('r1'),room('r2',100,'NEEDS_APPROVAL')];
 const locked=[assignment('A','MON_AM','r1',{locked:true})];
 const result=planSchedule({courses,rooms,locked});
 assert.deepEqual(result.assignments.filter(a=>a.courseId==='A'),locked);
 assert.equal(new Set(result.assignments.map(a=>a.id)).size,result.assignments.length);
});
check('scheduler and detector agree about provider teams, including opt-out',()=>{
 const courses=[course('A'),course('B',{provider:'A'})],rooms=[room('r1'),room('r2')];
 const placed=[assignment('A')],b=assignment('B','MON_AM','r2');
 for(const providerIsSingleTeam of [true,false]){
  const options={providerIsSingleTeam};
  const blockers=placementBlockers({course:courses[1],courses,rooms,placed,slotId:'MON_AM',roomId:'r2',options});
  const conflicts=detectConflicts({courses,rooms,assignments:[...placed,b],options});
  assert.equal(blockers.includes('PROVIDER_BUSY'),providerIsSingleTeam);
  assert.equal(conflicts.some(c=>c.code==='PROVIDER_BUSY'),providerIsSingleTeam);
 }
});
check('onsite and hybrid require existing rooms in every entry point',()=>{
 for(const deliveryMode of ['ON_SITE','HYBRID']) for(const roomId of [null,'deleted']) {
  const courses=[course('A',{deliveryMode})],rooms=[room('r1')];
  assert(placementBlockers({course:courses[0],courses,rooms,placed:[],slotId:'MON_AM',roomId}).includes('NO_ROOM_AVAILABLE'));
  assert(detectConflicts({courses,rooms,assignments:[assignment('A','MON_AM',roomId)]}).some(c=>c.code==='NO_ROOM_AVAILABLE'));
  assert.throws(()=>placeAssignment({courses,rooms,assignments:[],courseId:'A',slotId:'MON_AM',roomId}));
 }
});
check('duplicate destination is rejected; moving preserves identity',()=>{
 const courses=[course('A',{sessionsPerWeek:2})],rooms=[room('r1')];
 const assignments=[assignment('A'),assignment('A','TUE_AM')];
 const input={courses,rooms,assignments,assignmentId:assignments[0].id,slotId:'TUE_AM',roomId:'r1'};
 assert.throws(()=>moveAssignment(input),/ปลายทาง/);
 assert.equal(assignments.length,2);
 const moved=moveAssignment({...input,slotId:'WED_AM'});
 assert.equal(moved[0].id,assignments[0].id);
 assert.equal(new Set(moved.map(a=>a.id)).size,2);
});
check('room-only moves preserve custom times and invalid ranges are refused',()=>{
 const courses=[course('A')],rooms=[room('r1'),room('r2')];
 const assignments=[assignment('A','MON_AM','r1',{startTime:'09:30',endTime:'11:00'})];
 const moved=moveAssignment({courses,rooms,assignments,assignmentId:assignments[0].id,slotId:'MON_AM',roomId:'r2'});
 assert.equal(moved[0].startTime,'09:30');
 assert.throws(()=>changeAssignmentTime(assignments,assignments[0].id,'11:00','10:00'));
 assert(detectConflicts({courses,rooms,assignments:[assignment('A','MON_AM','r1',{startTime:'11:00',endTime:'10:00'})]}).some(c=>c.code==='INVALID_TIME'));
});
console.log(`integrity: ok (${checks} checks)`);
