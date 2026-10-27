'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),nav=require('../public/calendar-navigation.js');
test('days zoom to 12 months, then 12 years, and drill back without committing a date',()=>{
 const s={year:2026,month:9,day:27,level:'days'};
 assert.equal(nav.label(s),'October 2026');nav.up(s);assert.equal(nav.label(s),'2026');assert.equal(nav.cells(s).length,12);
 nav.up(s);assert.equal(nav.label(s),'2020 – 2029');assert.equal(nav.cells(s)[0].value,2019);assert.equal(nav.cells(s)[11].value,2030);
 assert.equal(nav.pick(s,2020),true);assert.equal(s.level,'months');assert.equal(nav.pick(s,1),true);assert.equal(s.level,'days');assert.equal(s.day,27);
});
test('arrows navigate a month, a year or a decade at the current level',()=>{
 const s={year:2026,month:0,day:31,level:'days'};nav.move(s,-1);assert.deepEqual(s,{year:2025,month:11,day:31,level:'days'});
 nav.up(s);nav.move(s,-1);assert.equal(s.year,2024);nav.up(s);nav.move(s,-1);assert.equal(s.year,2014);
});
test('month/year navigation respects Backtest start/end bounds and future restrictions',()=>{
 const min='2020-03-15',max='2021-04-05',s={year:2020,month:2,day:15,level:'months'};
 assert.equal(nav.cells(s,min,max)[1].disabled,true);assert.equal(nav.pick(s,1,min,max),false);
 assert.equal(nav.move(s,-1,min,max),false);assert.equal(nav.move(s,1,min,max),true);
 assert.equal(nav.cells(s,min,max)[4].disabled,true);assert.equal(nav.pick(s,4,min,max),false);
 s.level='years';assert.equal(nav.cells(s,min,max).filter(x=>!x.disabled).length,2);assert.equal(nav.move(s,1,min,max),false);
 assert.equal(nav.pick(s,2026,min,max),false);assert.equal(nav.pick(s,2021,min,max),true);assert.equal(nav.pick(s,3,min,max),true);assert.equal(s.day,5);
});
test('leap years and month-end days are clamped rather than rolling into another month',()=>{
 const s={year:2024,month:0,day:31,level:'months'};nav.pick(s,1);assert.equal(s.day,29);nav.up(s);nav.up(s);nav.pick(s,2023);assert.equal(s.day,28);nav.pick(s,1);assert.equal(s.month,1);
});
test('year boundaries and invalid values cannot produce malformed dates',()=>{
 const s={year:1000,month:0,day:1,level:'days'};assert.equal(nav.move(s,-1),false);
 s.year=9999;s.month=11;assert.equal(nav.move(s,1),false);s.level='years';assert.equal(nav.move(s,1),false);assert.equal(nav.pick(s,10000),false);assert.equal(nav.pick(s,2020.5),false);
});
