'use strict';
// Run: node tests/strategy.test.js
// The LONG/SHORT AMD/FVG fixture isolates entry mechanics with controlled
// RSI outputs; it is NOT a historical backtest or accuracy estimate.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const raw=fs.readFileSync(path.join(root,'unified-strategy.js'),'utf8');
const strategy=require('../unified-strategy.js').UnifiedStrategy;
const bars=Array.from({length:60},(_,i)=>({
  t:i*300000,o:100+i,c:100+i,h:101+i,l:99+i,v:100
}));
assert.equal(strategy.rsi(bars).at(-1),100,'continuous gains RSI=100');
assert.equal(strategy.rsi(bars.map(x=>({...x,c:100}))).at(-1),50,'flat RSI=50');
const falling=bars.map((x,i)=>({...x,c:200-i}));
assert.equal(strategy.rsi(falling).at(-1),0,'continuous losses RSI=0');
const empty=strategy.evaluate({barsMonthly:[],barsWeekly:[],barsDaily:[],bars5:[],bars1:[],mark:100});
assert.equal(empty.status,'none');
assert.equal(empty.executionReady,false);
const now=Date.now(),n=127,base=now-(n+1)*60000;
const longBars=Array.from({length:n},(_,i)=>({
  t:base+i*60000,o:100,c:100.02,h:100.2,l:99.8,v:100
}));
Object.assign(longBars[118],{o:100,c:99.9,h:100.1,l:99.4});
Object.assign(longBars[119],{o:100,c:100.05,h:100.3,l:99.8});
Object.assign(longBars[120],{o:100.1,c:100.85,h:100.95,l:100.05});
Object.assign(longBars[121],{o:100.85,c:101.05,h:101.2,l:100.55});
for(let i=122;i<=124;i++)Object.assign(longBars[i],
  {o:100.95,c:100.9,h:101.05,l:100.8});
Object.assign(longBars[125],{o:100.41,c:100.7,h:100.75,l:100.35,v:250});
Object.assign(longBars[126],{o:100.75,c:100.78,h:100.9,l:100.7});
const fiveMin=Array.from({length:127},(_,i)=>({t:now-(127-i)*300000,o:100,c:100.02,h:100.2,l:99.8,v:100}));
const higher=Array.from({length:50},(_,i)=>({
  t:now-(50-i)*86400000,o:100,c:100+i,h:101+i,l:99+i,v:100
}));
function isolated(side){
  // Override only the higher-timeframe and divergence test inputs.
  // The accumulation/manipulation/FVG detection and decision code is real.
  const mocked=raw.replace(
    'const rm=rsi(barsMonthly),rw=rsi(barsWeekly),rd=rsi(barsDaily),r5=rsi(bars5);',
    side==='long'?
      'const rm=Array(barsMonthly.length).fill(60),rw=Array(barsWeekly.length).fill(60),rd=Array(barsDaily.length).fill(42),r5=Array(bars5.length).fill(35);r5[r5.length-10]=32;r5[r5.length-9]=38;':
      'const rm=Array(barsMonthly.length).fill(40),rw=Array(barsWeekly.length).fill(40),rd=Array(barsDaily.length).fill(58),r5=Array(bars5.length).fill(65);r5[r5.length-10]=68;r5[r5.length-9]=62;'
  ).replace('const dv=divergence(bars5,r5,side,bars5.length);',
    "const dv=side==='"+side+"'?{ok:true,a:60,b:120}:{ok:false};");
  assert.notEqual(mocked,raw,'test hooks found');
  const context={window:{}};
  vm.runInNewContext(mocked,context);
  return context.window.UnifiedStrategy;
}
for(const side of ['long','short']){
  const model=isolated(side);
  const candles=side==='long'?longBars:
    longBars.map(x=>({...x,o:200-x.o,c:200-x.c,h:200-x.l,l:200-x.h}));
  const evalBars=arr=>model.evaluate({
    barsMonthly:higher,barsWeekly:higher,barsDaily:higher,
    bars5:fiveMin,bars1:arr,mark:100,now
  });
  const found=evalBars(candles);
  assert.equal(found.status,'confirm',side+' positive setup');
  assert.equal(found.side,side);
  assert.equal(found.executionReady,false,'always simulation');
  assert.equal(found.checks.filter(c=>c.ok).length,found.checks.length,'all RSI filters and AMD required');
  assert.equal(found.plan.timeframe,'1m');
  assert.equal(found.strategyVersion,'RSI14_AMD_FVG_STRICT_SCALP_1M_V4');
  assert.ok(Math.abs(Math.abs(found.plan.tp2-found.plan.en)/
    Math.abs(found.plan.en-found.plan.stop)-3)<1e-9,'3R target');
  const noVolume=candles.map(x=>({...x}));
  noVolume[125].v=1;
  assert.notEqual(evalBars(noVolume).status,'confirm','volume required');
  const noSweep=candles.map(x=>({...x}));
  if(side==='long')noSweep[118].l=99.9;
  else noSweep[118].h=100.1;
  assert.notEqual(evalBars(noSweep).status,'confirm','sweep required');
}
const server=fs.readFileSync(path.join(root,'laptop-server.js'),'utf8');
assert.ok(!server.includes('liveBroker.onSignal('),'no live order submit path');
assert.ok(!server.includes('liveBroker.arm(data.phrase)'),'live arm is blocked');
console.log('PASS: RSI basics, strict selective V2 long/short 1m FVG entry fixtures, volume/sweep veto, 3R, simulation-only checks');
