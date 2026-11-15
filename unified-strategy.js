'use strict';
/*
 RSI(14) + Accumulation / Manipulation / Fair Value Gap / Distribution
 SELECTIVE SCALPING edition derived from the earlier STRICT V2 (not loose V3).
 Original RSI transcript: RSI momentum, divergence, 30/70 recovery,
 higher timeframe hierarchy, candle and volume confirmation.
 AMD and FVG are additional user-approved entry criteria, not transcript rules.
 The strategy is purely analytical; it never sends orders.
 All input candle arrays MUST contain only CLOSED candles sorted oldest to newest.
*/
(function(root){
 const isNum=n=>Number.isFinite(Number(n));
 const last=a=>a[a.length-1];
 function rsi(bars,period=14){
   if(!Array.isArray(bars)||bars.length<period+2)return [];
   const closes=bars.map(b=>Number(b.c));
   if(!closes.every(n=>Number.isFinite(n)&&n>0))return [];
   let gain=0,loss=0;
   for(let i=1;i<=period;i++){
     const d=closes[i]-closes[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);
   }
   gain/=period;loss/=period;
   const out=Array(bars.length).fill(null);
   const val=()=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);
   out[period]=val();
   for(let i=period+1;i<bars.length;i++){
     const d=closes[i]-closes[i-1];
     gain=(gain*(period-1)+Math.max(0,d))/period;
     loss=(loss*(period-1)+Math.max(0,-d))/period;
     out[i]=val();
   }
   return out;
 }
 function bullishCandle(b){
   const range=b.h-b.l,body=Math.abs(b.c-b.o);
   return b.c>b.o&&range>0&&
     (b.o-b.l>=body*1.25||body>=range*.5);
 }
 function bearishCandle(b){
   const range=b.h-b.l,body=Math.abs(b.c-b.o);
   return b.c<b.o&&range>0&&
     (b.h-b.o>=body*1.25||body>=range*.5);
 }
 function divergence(bars,values,side,end){
   // Confirmed pivot pairs, never compare a swing against an unfinished bar.
   const pivots=[];
   for(let i=Math.max(16,end-100);i<end-2;i++){
     if(values[i]==null||values[i-1]==null||values[i+1]==null)continue;
     const pivot=side==='long'?
       bars[i].l<bars[i-1].l&&bars[i].l<=bars[i+1].l:
       bars[i].h>bars[i-1].h&&bars[i].h>=bars[i+1].h;
     if(pivot)pivots.push(i);
   }
   // Divergence should precede manipulation within a bounded recent window.
   for(let j=pivots.length-1;j>=1;j--){
     const b=pivots[j];
     if(end-b>60)break;
     for(let k=j-1;k>=0;k--){
       const a=pivots[k];
       if(b-a<3||b-a>65)continue;
       if(side==='long'&&bars[b].l<bars[a].l&&values[b]>values[a]+1)
         return {ok:true,a,b,priceA:bars[a].l,priceB:bars[b].l,rsiA:values[a],rsiB:values[b]};
       if(side==='short'&&bars[b].h>bars[a].h&&values[b]<values[a]-1)
         return {ok:true,a,b,priceA:bars[a].h,priceB:bars[b].h,rsiA:values[a],rsiB:values[b]};
     }
   }
   return {ok:false};
 }
 function evaluate({barsMonthly,barsWeekly,barsDaily,bars5,bars1,mark,account=2000,risk=.5,now=Date.now()}={}){
   const empty=(reason)=>({status:'none',side:null,dir:null,ok:false,executionReady:false,
     reason,score:0,checks:[],G:[],plan:null,confirmationMode:'RSI14 selective HTF + 5m divergence/recovery + 1m AMD/FVG',
     strategyVersion:'RSI14_AMD_FVG_STRICT_SCALP_1M_V4'});
   if(![barsMonthly,barsWeekly,barsDaily,bars5,bars1].every(Array.isArray)||
      barsMonthly.length<20||barsWeekly.length<20||barsDaily.length<20||bars5.length<100||bars1.length<100||
      !(mark>0))return empty('Insufficient CLOSED monthly, weekly, daily, 5m RSI or 1m entry candles');
   const rm=rsi(barsMonthly),rw=rsi(barsWeekly),rd=rsi(barsDaily),r5=rsi(bars5);
   const m=last(rm),w=last(rw),d=last(rd),intraday=last(r5);
   if(![m,w,d,intraday].every(isNum))return empty('Insufficient RSI(14) values');
   const inspect=(side)=>{
     const dir=side==='long'?1:-1;
     const macro=side==='long'?m>45&&w>50:m<55&&w<50;
     // Slight widening from V2 (40–45 / 55–60), preserving the original
     // higher-timeframe logic and mandatory 5m divergence + RSI recovery.
     const pullback=side==='long'?d>=38&&d<=48:d>=52&&d<=62;
     const dv=divergence(bars5,r5,side,bars5.length);
     const reclaim=side==='long'?
       r5.slice(-45).some((v,i,a)=>i>0&&a[i-1]!=null&&a[i-1]<35&&v>=35):
       r5.slice(-45).some((v,i,a)=>i>0&&a[i-1]!=null&&a[i-1]>65&&v<=65);
     const checks=[
       {ok:macro,t:'Weekly RSI >/<50 and monthly RSI soft confirmation '+side.toUpperCase()},
       {ok:pullback,t:'Daily RSI selective pullback zone'},
       {ok:dv.ok,t:'5m price/RSI divergence confirmed at price pivots'},
       {ok:reclaim,t:side==='long'?'5m RSI recovered above 35':'5m RSI fell back below 65'}
     ];
     const n=bars1.length;
     // Only near-current setups: 1m accumulation zone, stop sweep/reclaim,
     // directional displacement FVG, then a later retest confirming candle.
     let best=null;
     const begin=Math.max(24,n-55);
     for(let sweep=begin;sweep<n-5;sweep++){
       const rangeBars=bars1.slice(sweep-16,sweep);
       if(rangeBars.length!==16)continue;
       const hi=Math.max(...rangeBars.map(b=>b.h)),lo=Math.min(...rangeBars.map(b=>b.l));
       const width=hi-lo,base=(hi+lo)/2;
       if(!(width>0&&width/base<.06))continue;
       const candle=bars1[sweep];
       const swept=side==='long'?
         candle.l<lo&&candle.c>lo&&candle.c<hi:
         candle.h>hi&&candle.c<hi&&candle.c>lo;
       if(!swept)continue;
       // RSI divergence must precede the manipulation sweep, not occur later.
       if(!dv.ok||!bars5[dv.b]||bars5[dv.b].t>candle.t||candle.t-bars5[dv.b].t>40*300000)continue;
       // Require confirmed structural displacement away from swept liquidity.
       for(let f=sweep+2;f<=Math.min(n-3,sweep+14);f++){
         const a=bars1[f-2],mid=bars1[f-1],c=bars1[f];
         const gap=side==='long'?c.l-a.h:a.l-c.h;
         const low=side==='long'?a.h:c.h,high=side==='long'?c.l:a.l;
         const midBody=Math.abs(mid.c-mid.o);
         const avgBody=rangeBars.reduce((sum,x)=>sum+Math.abs(x.c-x.o),0)/16;
         const displacement=side==='long'?mid.c>mid.o&&mid.c>hi:
           mid.c<mid.o&&mid.c<lo;
         if(!displacement||!(gap>base*.0001&&midBody>avgBody*1.3))continue;
         const stop=side==='long'?Math.min(candle.l,lo)-base*.00015:
           Math.max(candle.h,hi)+base*.00015;
         let invalid=false;
         for(let k=f+1;k<n;k++){
           const bar=bars1[k];
           if((side==='long'&&bar.l<=stop)||(side==='short'&&bar.h>=stop)){
             invalid=true;break;
           }
           const touched=bar.l<=high&&bar.h>=low;
           if(!touched)continue;
           // FVG candle must close in trade direction with a meaningful body,
           // and volume must exceed the mean of five preceding 1m bars.
           const preceding=bars1.slice(Math.max(0,k-5),k);
           const avgVol=preceding.reduce((sum,x)=>sum+(+x.v||0),0)/preceding.length;
           const volumeOK=avgVol>0&&bar.v>avgVol*1.1;
           const confirmation=side==='long'?bullishCandle(bar):bearishCandle(bar);
           if(!volumeOK||!confirmation)continue;
           // Do not retroactively create a fresh entry from an old setup.
           if(k<n-2||now-(bar.t+60000)>3*60000)continue;
           const entry=bar.c,dist=dir*(entry-stop);
           if(!(dist>0&&dist/entry<=.02))continue;
           const plan={en:entry,stop,tp1:entry+dir*3*dist,tp2:entry+dir*3*dist,
             rr:3,sp:dist/entry*100,r$:Math.max(0,Number(account)*Number(risk)/100),
             ck:bar.t,timeframe:'1m',targetMode:'fixed3r',
             setupType:'RSI14 selective / accumulation / manipulation / FVG retest / distribution target',
             fvgZone:{low,high},fvgFormedAt:c.t,fvgFilledAt:bar.t,
             volumeDirection:side,fvgVolumeRatio:avgVol>0?bar.v/avgVol:null,
             firstSweepPrice:side==='long'?candle.l:candle.h,
             secondSweepPrice:side==='long'?candle.l:candle.h,
             structureExtreme:side==='long'?candle.l:candle.h,
             previousDayLevel:null,researchOnly:true};
           best={plan,range:{low:lo,high:hi},sweepTime:candle.t,
             divergence:dv,volumeRatio:plan.fvgVolumeRatio,
             fvg:{formed:true,filled:true,volumeConfirmed:true,low,high,
               formedAt:c.t,filledAt:bar.t,triggerTime:bar.t,triggerPrice:bar.c,
               reason:'Directional closed 1m candle with volume at FVG retest'},
             pattern:{name:side==='long'?'Bullish FVG retest':'Bearish FVG retest',
               confirmTime:bar.t,confirmClose:bar.c}};
         }
       }
     }
     checks.push({ok:!!best,t:'Accumulation range + manipulation liquidity sweep'},
       {ok:!!best,t:'Displacement formed directional 3-candle FVG'},
       {ok:!!best,t:'Subsequent FVG retest + 1m directional closed candle and volume'});
     const pass=macro&&pullback&&dv.ok&&reclaim&&!!best;
     const score=checks.filter(x=>x.ok).length/checks.length*100;
     return {side,dir:side,status:pass?'confirm':checks.some(x=>x.ok)?'watch':'none',
       ok:pass,score:pass?100:Math.min(99,Math.round(score)),
       executionReady:false,
       reason:pass?'RSI14 selective V2 bias + AMD sweep + FVG retest confirmed: distribution is target':
          checks.find(x=>!x.ok)?.t||'Waiting for complete setup',
       checks,G:checks,plan:pass?best.plan:null,
       pattern:pass?best.pattern:null,
       liquidity:best?{ok:true,firstSweep:true,secondSweep:true,
         level:side==='long'?best.range.low:best.range.high,
         range:best.range,sweepTime:best.sweepTime}:null,
       fvg:best?.fvg||null,volumeRatio:best?.volumeRatio??null,
       rsi:{monthly:m,weekly:w,daily:d,intraday5m:intraday,
         divergence:dv.ok?dv:null,recovery:reclaim},
       confirmationMode:'RSI14 selective HTF + 5m divergence/recovery + 1m AMD/FVG',
       strategyVersion:'RSI14_AMD_FVG_STRICT_SCALP_1M_V4'};
   };
   const longs=inspect('long'),shorts=inspect('short');
   if(longs.ok&&shorts.ok)return {...longs,status:'watch',ok:false,plan:null,
     reason:'Conflicting long and short confirmations',executionReady:false};
   if(longs.ok)return longs;
   if(shorts.ok)return shorts;
   return longs.score>=shorts.score?longs:shorts;
 }
 root.UnifiedStrategy=Object.freeze({rsi,divergence,evaluate,
   activeStrategy:'RSI14_AMD_FVG_STRICT_SCALP_1M_V4'});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
