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
const empty=strategy.evaluate({bars15:[],bars5:[],bars1:[],mark:100});
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
const fiveMin=Array.from({length:70},(_,i)=>({t:now-(70-i)*300000,o:100,c:100.02,h:100.2,l:99.8,v:100}));
const fifteenMin=Array.from({length:70},(_,i)=>({t:now-(70-i)*900000,o:100,c:100.02,h:100.2,l:99.8,v:100}));
function isolated(side){
  // Override only the higher-timeframe and divergence test inputs.
  // The accumulation/manipulation/FVG detection and decision code is real.
  const mocked=raw.replace(
    'const r15=rsi(bars15),r5=rsi(bars5),r1=rsi(bars1);',
    side==='long'?
      'const r15=Array(bars15.length).fill(56),r5=Array(bars5.length).fill(51),r1=Array(bars1.length).fill(53);':
      'const r15=Array(bars15.length).fill(44),r5=Array(bars5.length).fill(49),r1=Array(bars1.length).fill(47);'
  );
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
    bars15:fifteenMin,bars5:fiveMin,bars1:arr,mark:100,now
  });
  const found=evalBars(candles);
  assert.equal(found.status,'confirm',side+' positive setup');
  assert.equal(found.side,side);
  assert.equal(found.executionReady,false,'always simulation');
  assert.ok(found.checks.some(c=>c.t.includes('optional')&&!c.ok),'optional divergence does not block scalp');
  assert.equal(found.plan.timeframe,'1m');
  assert.equal(found.strategyVersion,'RSI14_AMD_FVG_SCALP_1M_V3');
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
console.log('PASS: RSI basics, long/short RSI scalp 1m FVG entry fixtures, volume/sweep veto, 3R, simulation-only checks');
