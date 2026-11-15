'use strict';
/*
 RSI(14) + Accumulation / Manipulation / Fair Value Gap / Distribution
 SCALPING edition. Source transcript: RSI momentum, divergence, 30/70 recovery,
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
 function evaluate({bars15,bars5,bars1,mark,account=2000,risk=.5,now=Date.now()}={}){
   const empty=(reason)=>({status:'none',side:null,dir:null,ok:false,executionReady:false,
     reason,score:0,checks:[],G:[],plan:null,confirmationMode:'RSI14 15m/5m trend + 1m AMD/FVG scalp',
     strategyVersion:'RSI14_AMD_FVG_SCALP_1M_V3'});
   if(![bars15,bars5,bars1].every(Array.isArray)||
      bars15.length<40||bars5.length<40||bars1.length<90||!(mark>0))
      return empty('Insufficient CLOSED 15m trend, 5m momentum or 1m entry candles');
   const r15=rsi(bars15),r5=rsi(bars5),r1=rsi(bars1);
   const htf=last(r15),momentum=last(r5),local=last(r1);
   if(![htf,momentum,local].every(x=>typeof x==='number'&&Number.isFinite(x)))
     return empty('RSI(14) is not available');
   const inspect=(side)=>{
     const dir=side==='long'?1:-1;
     // Adaptation for scalping: remove daily/weekly/monthly positional filters.
     // 15m identifies direction; 5m must not contradict the immediate trade.
     const trend=side==='long'?htf>50:htf<50;
     const momentumOK=side==='long'?momentum>=45:momentum<=55;
     const localOK=side==='long'?local>=46:local<=54;
     // These enhance a signal but do not veto a valid short-term AMD/FVG entry.
     const dv=divergence(bars1,r1,side,bars1.length);
     const reclaim=side==='long'?
       r1.slice(-25).some((v,i,a)=>i>0&&a[i-1]!=null&&a[i-1]<30&&v>=30):
       r1.slice(-25).some((v,i,a)=>i>0&&a[i-1]!=null&&a[i-1]>70&&v<=70);
     const checks=[
       {ok:trend,t:'15m RSI trend '+side.toUpperCase()},
       {ok:momentumOK,t:'5m RSI supports the scalp'},
       {ok:localOK,t:'1m RSI does not oppose entry'},
       {ok:dv.ok,t:'1m RSI divergence (optional confluence)'},
       {ok:reclaim,t:'1m RSI 30/70 recovery (optional confluence)'}
     ];
     const n=bars1.length;
     // Only near-current setups: 1m accumulation zone, stop sweep/reclaim,
     // directional displacement FVG, then a later retest confirming candle.
     let best=null;
     const begin=Math.max(16,n-70);
     for(let sweep=begin;sweep<n-4;sweep++){
       const rangeBars=bars1.slice(sweep-12,sweep);
       if(rangeBars.length!==12)continue;
       const hi=Math.max(...rangeBars.map(b=>b.h)),lo=Math.min(...rangeBars.map(b=>b.l));
       const width=hi-lo,base=(hi+lo)/2;
       if(!(width>0&&width/base<.035))continue;
       const candle=bars1[sweep];
       const swept=side==='long'?
         candle.l<lo&&candle.c>lo&&candle.c<hi:
         candle.h>hi&&candle.c<hi&&candle.c>lo;
       if(!swept)continue;
       // RSI divergence is additional confluence for scalping, not an absolute veto.
       // Require confirmed structural displacement away from swept liquidity.
       for(let f=sweep+2;f<=Math.min(n-3,sweep+12);f++){
         const a=bars1[f-2],mid=bars1[f-1],c=bars1[f];
         const gap=side==='long'?c.l-a.h:a.l-c.h;
         const low=side==='long'?a.h:c.h,high=side==='long'?c.l:a.l;
         const midBody=Math.abs(mid.c-mid.o);
         const avgBody=rangeBars.reduce((sum,x)=>sum+Math.abs(x.c-x.o),0)/12;
         const displacement=side==='long'?mid.c>mid.o&&mid.c>hi:
           mid.c<mid.o&&mid.c<lo;
         if(!displacement||!(gap>base*.00005&&midBody>avgBody*1.15))continue;
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
           const volumeOK=avgVol>0&&bar.v>=avgVol*1.05;
           const confirmation=side==='long'?bullishCandle(bar):bearishCandle(bar);
           if(!volumeOK||!confirmation)continue;
           // Do not retroactively create a fresh entry from an old setup.
           if(k<n-3||now-(bar.t+60000)>5*60000)continue;
           const entry=bar.c,dist=dir*(entry-stop);
           if(!(dist>0&&dist/entry<=.02))continue;
           const plan={en:entry,stop,tp1:entry+dir*3*dist,tp2:entry+dir*3*dist,
             rr:3,sp:dist/entry*100,r$:Math.max(0,Number(account)*Number(risk)/100),
             ck:bar.t,timeframe:'1m',targetMode:'fixed3r',
             setupType:'RSI14 scalp / accumulation / manipulation / FVG retest / distribution target',
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
     const pass=trend&&momentumOK&&localOK&&!!best;
     const score=checks.filter(x=>x.ok).length/checks.length*100;
     return {side,dir:side,status:pass?'confirm':checks.some(x=>x.ok)?'watch':'none',
       ok:pass,score:pass?100:Math.min(99,Math.round(score)),
       executionReady:false,
       reason:pass?'15m/5m RSI scalp bias + 1m AMD/FVG retest confirmed: distribution is target':
          checks.find(x=>!x.ok)?.t||'Waiting for complete setup',
       checks,G:checks,plan:pass?best.plan:null,
       pattern:pass?best.pattern:null,
       liquidity:best?{ok:true,firstSweep:true,secondSweep:true,
         level:side==='long'?best.range.low:best.range.high,
         range:best.range,sweepTime:best.sweepTime}:null,
       fvg:best?.fvg||null,volumeRatio:best?.volumeRatio??null,
       rsi:{trend15m:htf,intraday5m:momentum,entry1m:local,
         divergence:dv.ok?dv:null,recovery:reclaim},
       confirmationMode:'RSI14 scalp 15m/5m trend + 1m accumulation/manipulation/FVG',
       strategyVersion:'RSI14_AMD_FVG_SCALP_1M_V3'};
   };
   const longs=inspect('long'),shorts=inspect('short');
   if(longs.ok&&shorts.ok)return {...longs,status:'watch',ok:false,plan:null,
     reason:'Conflicting long and short confirmations',executionReady:false};
   if(longs.ok)return longs;
   if(shorts.ok)return shorts;
   return longs.score>=shorts.score?longs:shorts;
 }
 root.UnifiedStrategy=Object.freeze({rsi,divergence,evaluate,
   activeStrategy:'RSI14_AMD_FVG_SCALP_1M_V3'});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
