const test=require('node:test'), assert=require('node:assert/strict');
const {calculate}=require('../public/backtest-insights');
test('closed only; use chart month, not open date or risk; chronological peak from zero',()=>{
 const data=[{openDT:'2025-10-30T12:00',closeDT:'2025-11-01T00:05',r:-3,riskPercent:4},{closeDT:'2025-10-20T12:00',r:10},{openDT:'2025-10-30T12:00',r:20},{closeDT:'2026-01-01T00:00',r:4}];
 const s=calculate(data);assert.deepEqual(s.months.map(m=>[m.label,m.year,m.value]),[['Oct',2025,10],['Nov',2025,-3],['Dec',2025,0],['Jan',2026,4]]);assert.deepEqual(s.depths,[0,0,-3,0]);assert.equal(s.max,-3);
});
test('initial losing streak and empty test',()=>{assert.equal(calculate([-1,-1,-1].map(r=>({r,closeDT:'2025-01-01T12:00'}))).max,-3);assert.deepEqual(calculate([]).months,[]);});
