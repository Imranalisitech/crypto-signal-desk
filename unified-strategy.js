'use strict';
/*
 PDL LONG / PDH SHORT liquidity-sweep reversal + AMD / FVG (5m).
 Simulation-only analysis. Input bars must be CLOSED, chronological OHLCV.
 Previous-day levels are from the previous COMPLETE UTC day; never today's live high/low.
*/
(function(root){
 const VERSION='PDL_LONG_PDH_SHORT_AMD_FVG_REVERSAL_5M_V2';
 const last=a=>a[a.length-1];
 const valid=b=>b&&[b.o,b.h,b.l,b.c].every(x=>Number.isFinite(+x)&&+x>0)&&Number.isFinite(+b.t);
 const max=(a,key)=>Math.max(...a.map(x=>+x[key]));
 const min=(a,key)=>Math.min(...a.map(x=>+x[key]));
 const average=a=>a.reduce((s,v)=>s+v,0)/(a.length||1);
 function evaluate({barsDaily,bars5,mark,account=2000,risk=.5,now=Date.now()}={}){
  const base={status:'none',side:null,dir:null,ok:false,executionReady:false,score:0,checks:[],G:[],plan:null,strategyVersion:VERSION,confirmationMode:'5m PDL LONG / PDH SHORT sweep + accumulation + manipulation + FVG fill + return'};
  const blank=reason=>({...base,reason});
  if(!Array.isArray(barsDaily)||!Array.isArray(bars5)||barsDaily.length<2||bars5.length<65)
    return blank('Need prior completed UTC day and at least 65 closed 5m candles');
  if(!barsDaily.every(valid)||!bars5.every(valid))
    return blank('Invalid or unfinished candle data');
  const prior=last(barsDaily);
  const pdh=+prior.h,pdl=+prior.l;
  if(!(pdh>pdl&&pdl>0))return blank('Invalid previous-day high/low');
  const n=bars5.length;
  const atr=average(bars5.slice(-40).map(b=>+b.h-(+b.l)));
  if(!(atr>0))return blank('Insufficient 5m volatility');
  function inspect(side){
   const long=side==='long',dir=long?1:-1,level=long?pdl:pdh;
   const checks=[
    {ok:false,t:(long?'PDL':'PDH')+' liquidity breakout / sweep, reclaim and CLOSED 5m reversal displacement'},
    {ok:false,t:'Accumulation: 12 candles of compression near previous-day level'},
    {ok:false,t:'Manipulation: stop sweep and reclaim of accumulation range'},
    {ok:false,t:'Directional three-candle 5m fair value gap formed'},
    {ok:false,t:'Later FVG fill at least 50% and return close in reversal direction'}
   ];
   let setup=null,stage=0;
   // Restrict scanning to current-market structures, not distant historic signals.
   for(let sweep=Math.max(16,n-48);sweep<n-4;sweep++){
    const zone=bars5.slice(sweep-12,sweep);
    const hi=max(zone,'h'),lo=min(zone,'l');
    const width=hi-lo;
    const compressed=width>0&&width<=atr*3.5;
    const near=Math.abs((long?lo:hi)-level)<=atr*5;
    if(!compressed||!near)continue;
    checks[1].ok=true;stage=Math.max(stage,1);
    const m=bars5[sweep];
    const manipulated=long?(+m.l<Math.min(lo,level)&&+m.c>level&&+m.c>lo):(+m.h>Math.max(hi,level)&&+m.c<level&&+m.c<hi);
    if(!manipulated)continue;
    checks[2].ok=true;stage=Math.max(stage,2);
    // The PDH/PDL breakout is a liquidity sweep; displacement must REVERSE back inside the prior-day range.
    for(let f=sweep+2;f<=Math.min(n-2,sweep+13);f++){
      const a=bars5[f-2],middle=bars5[f-1],c=bars5[f];
      const gapLow=long?+a.h:+c.h, gapHigh=long?+c.l:+a.l;
      const gap=gapHigh-gapLow;
      const directional=long?(+middle.c>+middle.o&&+c.c>level&&+c.c>hi):
                            (+middle.c<+middle.o&&+c.c<level&&+c.c<lo);
      const breakout=long?(+m.l<level&&+m.c>level):(+m.h>level&&+m.c<level);
      if(!directional||!breakout)continue;
      checks[0].ok=true;stage=Math.max(stage,3);
      const body=Math.abs(+middle.c- +middle.o);
      const avgBody=average(zone.map(b=>Math.abs(+b.c- +b.o)));
      if(!(gap>=atr*.06&&body>=Math.max(atr*.45,avgBody*1.2)))continue;
      checks[3].ok=true;stage=Math.max(stage,4);
      const stop=long?Math.min(+m.l,lo)-atr*.1:Math.max(+m.h,hi)+atr*.1;
      // Confirmation is a SUBSEQUENT closed 5m candle that fills >=50% of
      // the FVG, then returns beyond its outer edge and holds the reclaimed level.
      for(let k=f+1;k<n;k++){
        const bar=bars5[k];
        if((long&&+bar.l<=stop)||(!long&&+bar.h>=stop))break;
        const midpoint=(gapLow+gapHigh)/2;
        const touchedHalf=long?(+bar.l<=midpoint&&+bar.h>=gapLow):
                               (+bar.h>=midpoint&&+bar.l<=gapHigh);
        if(!touchedHalf)continue;
        const returns=long?(+bar.c>gapHigh&&+bar.c>level&&+bar.c>+bar.o):
                            (+bar.c<gapLow&&+bar.c<level&&+bar.c<+bar.o);
        if(!returns)continue;
        checks[4].ok=true;stage=Math.max(stage,5);
        // Only new confirmations on the most recent fully CLOSED 5m candle.
        if(k!==n-1||now-(+bar.t+300000)>360000)continue;
        const entry=+bar.c;
        const distance=dir*(entry-stop);
        if(!(distance>0&&distance/entry<=.025))continue;
        setup={side,dir,level,entry,stop,bar,m,gapLow,gapHigh,gapFormed:+c.t,
         range:{low:lo,high:hi},rr:3,
         plan:{en:entry,stop,tp1:entry+dir*3*distance,tp2:entry+dir*3*distance,
          rr:3,sp:distance/entry*100,r$:Math.max(0,+account* +risk/100),
          ck:+bar.t,timeframe:'5m',targetMode:'fixed3r',
          setupType:'PDL LONG / PDH SHORT reversal + 5m accumulation/manipulation/FVG fill and return',
          previousDayLevel:level,previousDayHigh:pdh,previousDayLow:pdl,
          fvgZone:{low:gapLow,high:gapHigh},fvgFormedAt:+c.t,
          fvgFilledAt:+bar.t,firstSweepPrice:long?+m.l:+m.h,
          secondSweepPrice:long?+m.l:+m.h,
          structureExtreme:long?+m.l:+m.h,researchOnly:true}};
      }
    }
   }
   const ok=!!setup;
   const score=ok?100:Math.round(checks.filter(x=>x.ok).length/checks.length*100);
   return {...base,side,dir:side,status:ok?'confirm':stage?'watch':'none',
      ok,score,checks,G:checks,executionReady:false,
      reason:ok?(long?'PDL LONG':'PDH SHORT')+' 5m sweep/reclaim, accumulation, reversal FVG 50% fill and return confirmed':
        checks.find(x=>!x.ok)?.t||'Waiting for a new 5m confirmation',
      plan:setup?.plan||null,
      pattern:setup?{name:long?'PDL bullish reversal':'PDH bearish reversal',
        confirmTime:+setup.bar.t,confirmClose:setup.entry}:null,
      liquidity:setup?{ok:true,level:setup.level,range:setup.range,
        sweepTime:+setup.m.t}:null,
      fvg:setup?{formed:true,filled:true,low:setup.gapLow,high:setup.gapHigh,
        formedAt:setup.gapFormed,filledAt:+setup.bar.t,triggerTime:+setup.bar.t,
        triggerPrice:setup.entry}:null,
      previousDayLevel:level,previousDayHigh:pdh,previousDayLow:pdl};
  }
  const longs=inspect('long'),shorts=inspect('short');
  if(longs.ok&&shorts.ok)return {...base,status:'watch',reason:'Conflicting PDH and PDL setups'};
  if(longs.ok)return longs;
  if(shorts.ok)return shorts;
  return longs.score>=shorts.score?longs:shorts;
 }
 root.UnifiedStrategy=Object.freeze({evaluate,activeStrategy:VERSION});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
