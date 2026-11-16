'use strict';
/*
 ONE AND ONLY trade-entry method:
 5-minute PDL LONG / PDH SHORT double-structure neckline retest.
 Price action + three-candle FVG only. No RSI, EMA, volume, OB, HTF bias,
 divergence, momentum score or indicator filters.
 All OHLCV inputs must be FINISHED 5m candles, chronological.
 PDL/PDH are from the previous fully CLOSED UTC day.
 This module computes simulated signals and NEVER places exchange orders.
*/
(function(root){
 const VERSION='PDL_PDH_ONLY_NECKLINE_EXACT_RETEST_5M_V4';
 const num=x=>Number(x);
 const valid=b=>b&&[b.t,b.o,b.h,b.l,b.c].every(x=>Number.isFinite(num(x)))&&
   num(b.h)>=Math.max(num(b.o),num(b.c),num(b.l))&&
   num(b.l)<=Math.min(num(b.o),num(b.c),num(b.h))&&num(b.l)>0;
 const hi=a=>Math.max(...a.map(b=>num(b.h)));
 const lo=a=>Math.min(...a.map(b=>num(b.l)));
 const stamp=b=>num(b.t);
 function evaluate({barsDaily,bars5,mark,account=2000,risk=.5,now=Date.now()}={}){
  const base={status:'none',side:null,dir:null,ok:false,executionReady:false,
    score:0,checks:[],G:[],plan:null,strategyVersion:VERSION,
    confirmationMode:'PDL LONG / PDH SHORT 5m sweep → neckline breakout → 3-bar FVG → exact neckline retest → next closed candle'};
  const empty=reason=>({...base,reason});
  if(!Array.isArray(barsDaily)||!Array.isArray(bars5)||barsDaily.length<1||bars5.length<30)
    return empty('Need closed previous-day and 5-minute candles');
  if(!barsDaily.every(valid)||!bars5.every(valid))
    return empty('Invalid or incomplete OHLC candles');
  const day=barsDaily[barsDaily.length-1],pdl=num(day.l),pdh=num(day.h);
  if(!(pdh>pdl))return empty('Invalid previous-day range');
  const n=bars5.length;
  function inspect(side){
   const long=side==='long',sg=long?1:-1,level=long?pdl:pdh;
   const checks=[
    {ok:false,t:(long?'Sweep below PDL':'Sweep above PDH')+' after range formation'},
    {ok:false,t:'5m close '+(long?'ABOVE':'BELOW')+' original accumulation neckline'},
    {ok:false,t:'Directional three-candle FVG formed on the breakout move'},
    {ok:false,t:'Later pullback retests EXACT same neckline from '+(long?'above':'below')+' and fills >=50% FVG'},
    {ok:false,t:'A later CLOSED 5m '+(long?'bullish':'bearish')+' candle confirms beyond SAME neckline'}
   ];
   let found=null;
   // Include the most recent ~16 hours of closed 5m structure; no extra indicators.
   for(let sweep=Math.max(12,n-192);sweep<n-5;sweep++){
    const zone=bars5.slice(sweep-12,sweep);
    const neckline=long?hi(zone):lo(zone);
    const oldLow=lo(zone),oldHigh=hi(zone);
    const m=bars5[sweep];
    const swept=long?(num(m.l)<Math.min(level,oldLow)):
                     (num(m.h)>Math.max(level,oldHigh));
    if(!swept)continue;
    checks[0].ok=true;
    // First close beyond structural neckline occurs AFTER the liquidity sweep.
    for(let first=sweep+1;first<Math.min(n-3,sweep+16);first++){
     const b=bars5[first];
     const breaks=long?num(b.c)>neckline:num(b.c)<neckline;
     if(!breaks)continue;
     checks[1].ok=true;
     // FVG is a genuine 3-candle non-overlap created by the displacement
     // around the first neckline breakout (possibly up to three bars later).
     for(let f=Math.max(first,sweep+2);f<=Math.min(first+3,n-3);f++){
      const a=bars5[f-2],mid=bars5[f-1],c=bars5[f];
      const gapLow=long?num(a.h):num(c.h);
      const gapHigh=long?num(c.l):num(a.l);
      const gap=gapHigh-gapLow;
      const inDirection=long?(num(mid.c)>num(mid.o)&&num(c.c)>neckline):
                              (num(mid.c)<num(mid.o)&&num(c.c)<neckline);
      if(!(gap>0&&inDirection))continue;
      checks[2].ok=true;
      const half=(gapLow+gapHigh)/2;
      const stop=long?Math.min(num(m.l),oldLow)*(1-0.0001):
                      Math.max(num(m.h),oldHigh)*(1+0.0001);
      let retest=-1;
      for(let k=f+1;k<n-1&&k<=f+24;k++){
       const b2=bars5[k];
       if(long?num(b2.l)<=stop:num(b2.h)>=stop)break;
       // EXACT neckline touch, with rejection/holding on the intended side.
       // A wick alone qualifies as touching; a 5m close on the wrong side cancels.
       const touched=long?num(b2.l)<=neckline&&num(b2.h)>=neckline:
                             num(b2.h)>=neckline&&num(b2.l)<=neckline;
       const filled=long?num(b2.l)<=half&&num(b2.h)>=gapLow:
                            num(b2.h)>=half&&num(b2.l)<=gapHigh;
       const holds=long?num(b2.c)>=neckline:num(b2.c)<=neckline;
       if(!holds)break; // invalid neckline retest; do not silently confirm later
       if(retest<0){
        if(!(touched&&filled))continue;
        retest=k;
        checks[3].ok=true;
        continue; // entry is NEVER on the same bar as the retest
       }
       // After retest, a NEW candle must close in trend direction beyond neckline.
       if(k!==retest+1)continue;
       const confirmed=long?(num(b2.c)>neckline&&num(b2.c)>num(b2.o)):
                              (num(b2.c)<neckline&&num(b2.c)<num(b2.o));
       if(!confirmed)break;
       checks[4].ok=true;
       if(k!==n-1||now-(stamp(b2)+300000)>360000)break;
       const entry=num(b2.c),distance=sg*(entry-stop);
       if(!(distance>0))break;
       const target=entry+sg*3*distance;
       const plan={en:entry,stop,tp1:target,tp2:target,rr:3,
        sp:distance/entry*100,'r$':Math.max(0,num(account)*num(risk)/100),
        ck:stamp(b2),timeframe:'5m',targetMode:'fixed3r',
        setupType:'PDL/PDH sweep + first neckline break + FVG + exact neckline retest + second close',
        previousDayLevel:level,previousDayHigh:pdh,previousDayLow:pdl,
        neckline,necklineBreakAt:stamp(bars5[first]),
        fvgZone:{low:gapLow,high:gapHigh},fvgFormedAt:stamp(c),
        fvgRetestAt:stamp(bars5[retest]),fvgFilledAt:stamp(bars5[retest]),
        firstSweepPrice:long?num(m.l):num(m.h),
        structureExtreme:long?num(m.l):num(m.h),researchOnly:true};
       found={plan,neckline,sweep:m,bar:b2,
          gapLow,gapHigh,gapFormedAt:stamp(c),retestAt:stamp(bars5[retest]),
          range:{low:oldLow,high:oldHigh}};
       break;
      }
      if(found)break;
     }
     if(found)break;
     // First confirmed close is the reference; don't move the neckline.
     break;
    }
    if(found)break;
   }
   const pass=!!found;
   const score=pass?100:Math.round(checks.filter(x=>x.ok).length/checks.length*100);
   return {...base,side,dir:side,status:pass?'confirm':score?'watch':'none',
    ok:pass,score,checks,G:checks,executionReady:false,
    reason:pass?'Exact neckline retest and SECOND 5m close confirmed':
      checks.find(x=>!x.ok)?.t||'Awaiting exact neckline entry',
    plan:found?.plan||null,
    pattern:found?{name:long?'PDL long neckline rebreak':'PDH short neckline rebreak',
      confirmTime:stamp(found.bar),confirmClose:num(found.bar.c)}:null,
    liquidity:found?{ok:true,level,neckline:found.neckline,
      range:found.range,sweepTime:stamp(found.sweep)}:null,
    fvg:found?{formed:true,filled:true,low:found.gapLow,high:found.gapHigh,
      formedAt:found.gapFormedAt,filledAt:found.retestAt,
      triggerTime:stamp(found.bar),triggerPrice:num(found.bar.c)}:null,
    neckline:found?.neckline??null,
    previousDayLevel:level,previousDayHigh:pdh,previousDayLow:pdl};
  }
  const longs=inspect('long'),shorts=inspect('short');
  if(longs.ok&&shorts.ok)return empty('Opposing confirmed trades conflict');
  if(longs.ok)return longs;
  if(shorts.ok)return shorts;
  return longs.score>=shorts.score?longs:shorts;
 }
 root.UnifiedStrategy=Object.freeze({evaluate,activeStrategy:VERSION});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
