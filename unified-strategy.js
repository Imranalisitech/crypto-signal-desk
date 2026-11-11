'use strict';
/*
 DUAL_LIQUIDITY_RECLAIM-INSPIRED TWO-LINE CRYPTO FUTURES — DOUBLE LIQUIDITY CONFIRMATION

 ONLY entry inputs: completed previous UTC day's HIGH/LOW and CLOSED 1m
 OHLCV candles. No RSI, EMA, funding rate, VWAP, whales or heatmap.
 After DOUBLE liquidity confirmation, wait for a newly formed 1m fair
 value gap to be FULLY filled, and then a new directional volume candle.
 Long: BUY volume increases vs previous candle and prior 20-candle mean.
 Short: SELL candle with volume DECREASING vs both, as user requested.
 A declining-volume short candle is not proof of institutional selling.
 This volume rule is a user preference requiring empirical validation.
 User-requested extension beyond the published two-line technique:
  (1) first breach of previous-day liquidity,
  (2) distinct SECOND stop run beyond the first wick after a rebound,
  (3) reclaim the previous-day level and break interim swing structure,
  (4) two consecutive strong directional 1m candle bodies, with second
      closing beyond first candle's high/low.
 SL beyond SECOND wick (plus small market-noise buffer); TP always 3R.
 No indicator claims to identify actual institutional orders.
 These revised FVG/volume signals remain research/simulation only; the
 existing live Binance order block stays disabled until validated.
*/
(function(root){
 const DAY=86400000,ok=Number.isFinite;
 function priorUTCDay(bars15){
   if(!Array.isArray(bars15)||bars15.length<97)return null;
   const last=bars15.at(-1);
   if(!last||!ok(last.t))return null;
   const today=Math.floor(last.t/DAY)*DAY,prev=today-DAY;
   const list=bars15.filter(x=>x.t>=prev&&x.t<today)
     .sort((a,b)=>a.t-b.t);
   if(list.length!==96||list[0].t!==prev||
      list.at(-1).t!==prev+95*900000||
      !list.every((x,i)=>[x.t,x.o,x.h,x.l,x.c].every(ok)&&
        x.t===prev+i*900000))return null;
   return {start:prev,end:today-1,high:Math.max(...list.map(x=>x.h)),
     low:Math.min(...list.map(x=>x.l)),count:96,timeZone:'UTC'};
 }
 function median(xs){
   const nums=xs.filter(ok).sort((a,b)=>a-b);
   if(!nums.length)return 0;
   const n=nums.length;return n%2?nums[(n-1)/2]:
     (nums[n/2-1]+nums[n/2])/2;
 }
 function dualLiquidityReclaim(bars15,bars1,dir){
   const day=priorUTCDay(bars15);
   const sg=dir==='long'?1:dir==='short'?-1:0;
   const level=day?(sg===1?day.low:day.high):null;
   const base={ok:false,dir,day,level,stage:0,
     firstSweep:false,secondSweep:false,boundaryCrossed:false,
     levelReclaimed:false,structureBroken:false,strongPressure:false,
     confirmation:false,kind:'Dual Liquidity Reclaim · 1m crypto',
     reason:day?'Waiting for the first previous-day liquidity grab':
       'Previous completed UTC day unavailable'};
   if(!sg||!day||!Array.isArray(bars1)||bars1.length<110)return base;
   const n=bars1.length,utcStart=day.end+1;
   let best=base;
   const advance=candidate=>{
     if(candidate.stage>best.stage||
       candidate.stage===best.stage&&
       (candidate.triggerTime||candidate.secondTime||0)>
       (best.triggerTime||best.secondTime||0))best=candidate;
   };
   // Inspect only very recent confirmation candles; scanner latency is
   // separately limited before the signal can become a tradable entry.
   // Carry a completed double-sweep setup across subsequent scans while
   // waiting for its later FVG retracement (up to ~90 closed 1m candles).
   for(let j=n-1;j>=Math.max(2,n-90);j--){
     const b=bars1[j-1],c=bars1[j];
     if(!b||!c||b.t<utcStart||c.t-b.t!==60000||
       ![b.o,b.h,b.l,b.c,c.o,c.h,c.l,c.c].every(ok))continue;
     const prev=bars1.slice(Math.max(0,j-40),Math.max(0,j-3));
     const baseline=Math.max(median(prev.map(k=>k.h-k.l)),
       Math.abs(c.c)*.00008);
     const baselineBody=Math.max(median(prev.map(k=>Math.abs(k.c-k.o))),
       baseline*.22);
     const minTake=Math.max(baseline*.18,Math.abs(c.c)*.000045);
     const touched=bars1.slice(Math.max(0,j-100),j+1)
       .some(k=>k.t>=utcStart&&(sg===1?k.l<level:k.h>level));
     if(!touched)continue;
     advance({...base,stage:1,firstSweep:true,boundaryCrossed:true,
       reason:'Previous-day liquidity taken — waiting for SECOND stop run'});
     const isBreach=k=>sg===1?k.l<level-minTake:k.h>level+minTake;
     // Second grab can be the first bullish/bearish signal candle itself.
     // It must be distinct from the earlier wick, after a real rebound.
     // Initial reversal confirmation is tied to the second sweep, not
     // a much later bullish/bearish candle after the FVG retracement.
     for(let i2=j-1;i2>=Math.max(5,j-7);i2--){
       const second=bars1[i2];
       if(second.t<utcStart||!isBreach(second))continue;
       const lastWicks=bars1.slice(i2,j+1);
       const secondExtreme=sg===1?second.l:second.h;
       const surpassed=lastWicks.some(k=>sg===1?
         k.l<secondExtreme-minTake*.25:k.h>secondExtreme+minTake*.25);
       if(surpassed)continue; // a THIRD low/high invalidated the assumed final sweep
       for(let i1=i2-3;i1>=Math.max(3,i2-72);i1--){
         const first=bars1[i1];
         if(first.t<utcStart||!isBreach(first))continue;
         const firstExtreme=sg===1?first.l:first.h;
         if(!(sg===1?secondExtreme<firstExtreme-minTake:
           secondExtreme>firstExtreme+minTake))continue;
         const earlier=bars1.slice(i1,i2);
         if(earlier.some(k=>sg===1?k.l<secondExtreme+minTake:
           k.h>secondExtreme-minTake))continue;
         const between=bars1.slice(i1+1,i2);
         if(between.length<2)continue;
         const pivot=sg===1?Math.max(...between.map(k=>k.h)):
           Math.min(...between.map(k=>k.l));
         // Require a meaningful intermediate pullback, not consecutive
         // candles trending monotonically down/up past the prior-day line.
         const rebound=sg===1?pivot-firstExtreme:firstExtreme-pivot;
         if(rebound<baseline*1.4)continue;
         const candidate={...base,stage:2,firstSweep:true,secondSweep:true,
           boundaryCrossed:true,firstExtreme,secondExtreme,
           firstTime:first.t,secondTime:second.t,
           structureBreakLevel:pivot,baseline,
           reason:'Second liquidity grab detected — waiting for line reclaim'};
         advance(candidate);
         const reclaimed=sg===1?c.c>level+baseline*.07:
           c.c<level-baseline*.07;
         if(!reclaimed)continue;
         candidate.levelReclaimed=true;candidate.stage=3;
         candidate.reason='Previous-day level reclaimed — waiting for swing break';
         advance({...candidate});
         const broken=sg===1?c.c>pivot+baseline*.08:
           c.c<pivot-baseline*.08;
         if(!broken)continue;
         candidate.structureBroken=true;candidate.stage=4;
         candidate.reason='Intervening swing broken — waiting for strong 1m buying/selling';
         advance({...candidate});
         const bodyB=Math.abs(b.c-b.o),bodyC=Math.abs(c.c-c.o);
         const rangeB=Math.max(1e-12,b.h-b.l);
         const rangeC=Math.max(1e-12,c.h-c.l);
         const bodyRatioB=bodyB/rangeB,bodyRatioC=bodyC/rangeC;
         const consecutive=sg*(b.c-b.o)>0&&sg*(c.c-c.o)>0;
         const candlesStrong=consecutive&&
           bodyRatioB>=.5&&bodyRatioC>=.58&&
           bodyB>=baselineBody*1.05&&bodyC>=baselineBody*1.4&&
           (sg===1?c.c>b.h+baseline*.04:
             c.c<b.l-baseline*.04);
         if(!candlesStrong)continue;
         candidate.strongPressure=true;candidate.stage=5;
         candidate.reason='Second grab, structure break and strong candles confirmed';
         advance({...candidate});
         // Every price used is a CLOSED 1m candle. The second sweep
         // remains the relevant stop-loss reference.
         return {...candidate,ok:true,confirmation:true,stage:6,
           triggerTime:c.t,signalTime:b.t,triggerPrice:c.c,
           extreme:secondExtreme,bodyRatioB,bodyRatioC,
           bodyMultiple:bodyC/baselineBody,firstSweep:true,secondSweep:true,
           strongPressure:true,
           name:sg===1?
             'PDL → second lower-low sweep → strong bullish 1m break':
             'PDH → second higher-high sweep → strong bearish 1m break',
           reason:'Double liquidity grab, reclaimed level, broken swing and strong directional candles'};
       }
     }
   }
   return best;
 }

 function afterConfirmationFvg(bars1,g,side){
   const sg=side==='long'?1:-1;
   const base={ok:false,formed:false,filled:false,volumeConfirmed:false,
     stage:0,reason:'Waiting for a new directional fair value gap AFTER the double-sweep confirmation'};
   if(!g?.ok||!Array.isArray(bars1)||bars1.length<35)return base;
   const n=bars1.length;
   const confirmedIndex=bars1.findIndex(x=>x.t===g.triggerTime);
   if(confirmedIndex<2)return base;
   // The imbalance must be created by displacement at or following the
   // earlier double-sweep confirmation; never reuse an older unrelated FVG.
   const lookback=bars1.slice(Math.max(0,confirmedIndex-30),confirmedIndex);
   const baseRange=Math.max(median(lookback.map(x=>x.h-x.l)),
     Math.abs(bars1[confirmedIndex].c)*.00005);
   const minWidth=Math.max(baseRange*.12,Math.abs(bars1[confirmedIndex].c)*.00008);
   let pending=base,final=null;
   const advance=x=>{
     if(x.stage>pending.stage||x.stage===pending.stage&&
       (x.filledAt||x.formedAt||0)>(pending.filledAt||pending.formedAt||0))
       pending=x;
   };
   for(let i=confirmedIndex+1;i<=Math.min(n-3,confirmedIndex+25);i++){
     const first=bars1[i-2],third=bars1[i];
     if(!first||!third||!Number.isFinite(first.v)||!Number.isFinite(third.v))
       continue;
     const low=sg===1?first.h:third.h;
     const high=sg===1?third.l:first.l;
     if(!(high-low>=minWidth&&high>low&&
       sg*(third.c-first.c)>baseRange*.25))continue;
     const zone={low,high,formedAt:third.t,formedIndex:i};
     const fresh={...base,...zone,formed:true,stage:1,
       reason:'Directional FVG formed; waiting for FULL gap fill before entry'};
     advance(fresh);
     // Full fill reaches the far edge: bullish retest low <= FVG lower
     // boundary, bearish retest high >= FVG upper boundary.
     for(let k=i+1;k<=Math.min(n-2,i+75);k++){
       const touch=bars1[k];
       const fullyFilled=sg===1?touch.l<=low:touch.h>=high;
       if(!fullyFilled)continue;
       const filled={...fresh,filled:true,stage:2,
         filledAt:touch.t,fillExtreme:sg===1?touch.l:touch.h,
         reason:'Full FVG fill detected; awaiting new volume-confirmed directional 1m close'};
       advance(filled);
       // The fill is NOT itself an entry; wait for a subsequent CLOSED candle.
       // Avoid retroactively approving a setup after an additional deeper
       // sweep invalidated the original protected stop level.
       for(let m=k+1;m<=Math.min(n-1,k+12);m++){
         const candle=bars1[m],prev=bars1[m-1];
         const sinceSweep=bars1.slice(confirmedIndex+1,m+1);
         const stopBroken=sinceSweep.some(x=>sg===1?
           x.l<g.secondExtreme-baseRange*.05:
           x.h>g.secondExtreme+baseRange*.05);
         if(stopBroken)continue;
         const priorVolume=bars1.slice(Math.max(0,m-20),m)
           .map(x=>Number(x.v)).filter(x=>Number.isFinite(x)&&x>0);
         if(priorVolume.length<12||!(Number(candle.v)>0)||
            !(Number(prev.v)>0))continue;
         const avgVolume=priorVolume.reduce((a,b)=>a+b,0)/priorVolume.length;
         const ratio=candle.v/avgVolume;
         const directionalBody=sg*(candle.c-candle.o)>0;
         const bodyRatio=Math.abs(candle.c-candle.o)/
           Math.max(1e-12,candle.h-candle.l);
         const breaksLast=sg===1?candle.c>prev.h:candle.c<prev.l;
         const reclaimsZone=sg===1?candle.c>high:candle.c<low;
         // Requested asymmetry, deliberate: high BUY volume for LONG;
         // reduced volume with strong red price candle for SHORT.
         const volumeOK=sg===1?
           ratio>=1.25&&candle.v>=prev.v*1.08:
           ratio<=.80&&candle.v<=prev.v*.92;
         if(!directionalBody||bodyRatio<.55||!breaksLast||
            !reclaimsZone||!volumeOK)continue;
         const done={...filled,ok:true,volumeConfirmed:true,stage:3,
           triggerTime:candle.t,signalTime:prev.t,
           triggerPrice:candle.c,volumeRatio:ratio,
           priorVolume:prev.v,confirmationVolume:candle.v,
           volumeDirection:sg===1?'Increasing BUY-side candle volume':
             'Decreasing volume on bearish candle',
           confirmedCandle:candle.t,
           reason:sg===1?
             'Double sweep → bullish FVG fully filled → rising-volume bullish confirmation':
             'Double sweep → bearish FVG fully filled → falling-volume bearish confirmation'};
         if(!final||done.triggerTime>final.triggerTime)final=done;
       }
     }
   }
   return final||pending;
 }
 function evaluate({bars15,bars1,mark,account=2000,risk=.5,now=Date.now()}){
   if(!Array.isArray(bars15)||!Array.isArray(bars1)||
      bars15.length<97||bars1.length<110||!ok(mark)||mark<=0)
     return {status:'none',side:null,reason:'Waiting for previous UTC day / closed 1m candles',
       checks:[],G:[],score:0,executionReady:false,
       confirmationMode:'Dual Liquidity Reclaim double liquidity · 1m'};
   const both=['long','short'].map(side=>{
     const sg=side==='long'?1:-1;
     const g=dualLiquidityReclaim(bars15,bars1,side);
     const fvg=afterConfirmationFvg(bars1,g,side);
     const stop=g.ok?g.extreme-sg*Math.max(mark*.0001,g.baseline*.22):null;
     const stopOK=g.ok&&ok(stop)&&sg*(mark-stop)>0;
     const distance=stopOK?Math.abs(mark-stop):0;
     const sp=stopOK?distance/mark*100:null;
     const drift=fvg.ok?Math.abs(mark-fvg.triggerPrice):Infinity;
     const maxDrift=fvg.ok?Math.max(g.baseline*1.25,
       Math.abs(fvg.triggerPrice-g.extreme)*.25,mark*.001):0;
     const priceOK=fvg.ok&&drift<=maxDrift;
     const age=fvg.ok?now-(fvg.triggerTime+60000):Infinity;
     const fresh=fvg.ok&&age>=-30000&&age<=4*60000;
     const confirmed=!!(g.ok&&fvg.ok&&stopOK&&priceOK&&fresh);
     const cashRisk=Math.max(0,Number(account)*Number(risk)/100);
     const notional=stopOK&&sp>0?cashRisk/(sp/100):null;
     const plan=confirmed?{
       en:mark,stop,tp1:mark+sg*3*distance,tp2:mark+sg*3*distance,
       sp,r$:cashRisk,nt:notional,
       lev:Number(account)>0&&notional!=null?notional/Number(account):null,
       ck:fvg.triggerTime,rr:3,tp1pct:sp*3,tp2pct:sp*3,
       timeframe:'1m',targetMode:'fixed3r',
       setupType:'Dual Liquidity Reclaim + full FVG fill + volume confirmation',
       structureExtreme:g.extreme,
       firstSweepPrice:g.firstExtreme,secondSweepPrice:g.secondExtreme,
       breakLevel:g.structureBreakLevel,
       bodyMultiple:g.bodyMultiple,
       fvgZone:{low:fvg.low,high:fvg.high},
       fvgFormedAt:fvg.formedAt,fvgFilledAt:fvg.filledAt,
       fvgVolumeRatio:fvg.volumeRatio,
       volumeDirection:fvg.volumeDirection,
       previousDayLevel:g.day,
       researchOnly:true
     }:null;
     const checks=[
       {ok:!!g.day,t:'Completed previous-day PDH/PDL'},
       {ok:g.firstSweep,t:'First liquidity grab beyond previous-day line'},
       {ok:g.secondSweep,t:'Second, deeper liquidity grab after a rebound'},
       {ok:g.levelReclaimed,t:'Previous-day high/low reclaimed'},
       {ok:g.structureBroken,t:'Intervening 1m swing structure broken'},
       {ok:g.strongPressure,t:'Two strong directional 1m candle closes'},
       {ok:fvg.formed,t:'NEW 1m FVG formed after structure confirmation'},
       {ok:fvg.filled,t:'Price fully filled the FVG, after its formation'},
       {ok:fvg.volumeConfirmed,t:side==='long'?
         'New bullish candle with increasing volume':
         'New bearish candle with decreasing volume'},
       {ok:!!stopOK,t:'Stop outside second sweep wick'},
       {ok:!!priceOK,t:'Entry near confirmed trigger'},
       {ok:!!fresh,t:'Confirmation still recent'}
     ];
     const pendingScore=Math.min(99,Math.max(0,g.stage*11+
       (fvg.formed?9:0)+(fvg.filled?12:0)));
     return {side,status:confirmed?'confirm':g.firstSweep?'watch':'none',
       score:confirmed?100:pendingScore,
       pattern:confirmed?{name:sg===1?
           'Full bullish FVG fill → rising volume green 1m candle':
           'Full bearish FVG fill → falling volume red 1m candle',
         confirmTime:fvg.triggerTime,confirmClose:fvg.triggerPrice,
         patternTime:fvg.signalTime,extreme:g.extreme}:null,
       liquidity:g,fvg,volumeRatio:fvg.volumeRatio??null,
       confirmationMode:'Dual Liquidity Reclaim · FVG fill + directional 1m volume',
       executionReady:false,checks,G:checks,plan,ok:confirmed,
       reason:confirmed?fvg.reason:fvg.ok?
         'FVG volume confirmed, but entry is stale or structural stop invalid':
         g.ok?fvg.reason:g.reason};
   });
   both.sort((a,b)=>Number(b.ok)-Number(a.ok)||b.score-a.score);
   if(both[0].ok&&both[1].ok)
     return {...both[0],status:'watch',plan:null,ok:false,
       executionReady:false,reason:'Conflicting LONG and SHORT structure'};
   return both[0];
 }
 root.UnifiedStrategy=Object.freeze({
   priorUTCDay,dualLiquidityReclaim,afterConfirmationFvg,evaluate,
   activeStrategy:'DUAL_LIQUIDITY_FVG_VOLUME_1M_CRYPTO_V3'
 });
})(window);
