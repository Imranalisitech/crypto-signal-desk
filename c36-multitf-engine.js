'use strict';
/* C36 documented-rule reconstruction, simulation ONLY.
   This engine is derived from the user's documented C36 flow, not a verified
   copy of the earlier private Windows V8 detector. No order APIs. */
(function(root){
 const TF_MS={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
 const VERSION='C36_DOCUMENTED_DOUBLE_CONFIRMATION_V1';
 const num=x=>Number(x);
 function candleEnd(t,tf){
  if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
  return num(t)+(TF_MS[tf]||0);
 }
 function closed(b,tf,now=Date.now()){
  const arr=Array.isArray(b)?b.filter(x=>x&&[x.t,x.o,x.h,x.l,x.c,x.v].every(z=>Number.isFinite(num(z)))&&
    num(x.h)>=Math.max(num(x.o),num(x.c),num(x.l))&&num(x.l)>0&&num(x.v)>=0&&candleEnd(x.t,tf)<=now-1500).map(x=>({
    t:num(x.t),o:num(x.o),h:num(x.h),l:num(x.l),c:num(x.c),v:num(x.v)
  })).sort((a,z)=>a.t-z.t):[];
  return arr.filter((x,i)=>!i||x.t!==arr[i-1].t);
 }
 function ema(b,n){
  const out=Array(b.length).fill(null),k=2/(n+1);let sum=0;
  b.forEach((c,i)=>{if(i<n){sum+=c.c;if(i===n-1)out[i]=sum/n;}else out[i]=out[i-1]+k*(c.c-out[i-1]);});
  return out;
 }
 function indicators(b,tf){
  const fast=ema(b,9),slow=ema(b,21),atr=Array(b.length).fill(null),vwap=Array(b.length).fill(null);
  let trSum=0,prevAtr=0,vol=0,pv=0,lastSession='';
  for(let i=0;i<b.length;i++){
   const x=b[i],tr=i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):x.h-x.l;
   if(i>0&&i<=14){trSum+=tr;if(i===14){prevAtr=trSum/14;atr[i]=prevAtr;}}
   else if(i>14){prevAtr=(prevAtr*13+tr)/14;atr[i]=prevAtr;}
   const key=(TF_MS[tf]&&TF_MS[tf]<86400000)?new Date(x.t).toISOString().slice(0,10):String(Math.floor(i/20));
   if(key!==lastSession){lastSession=key;vol=0;pv=0;}
   const typical=(x.h+x.l+x.c)/3;vol+=x.v;pv+=typical*x.v;
   vwap[i]=vol>0?pv/vol:typical;
  }
  return {fast,slow,atr,vwap};
 }
 function contiguous(b,tf){
  for(let i=1;i<b.length;i++)if(candleEnd(b[i-1].t,tf)!==b[i].t)return false;
  return true;
 }
 function setup(b,ind,i,side){
  if(i<45||!(ind.atr[i]>0&&ind.fast[i]>0&&ind.slow[i]>0))return null;
  const long=side==='long',s=long?1:-1,x=b[i],a=ind.atr[i],f=ind.fast[i],slow=ind.slow[i],vwap=ind.vwap[i];
  // The SAME complete function must pass for the first and second confirmation.
  const trend=s*(f-slow)>.08*a&&s*(f-ind.fast[i-3])>.04*a&&
    s*(slow-ind.slow[i-3])>=0&&s*(x.c-vwap)>0;
  const pullback=b.slice(i-5,i).some((y,z)=>{
    const j=i-5+z;
    return long?(y.l<=ind.fast[j]+.16*a&&y.c>=ind.slow[j]-.5*a):
                (y.h>=ind.fast[j]-.16*a&&y.c<=ind.slow[j]+.5*a);
  });
  const ref=b.slice(i-5,i),breakout=long?x.c>Math.max(...ref.map(y=>y.h)) :x.c<Math.min(...ref.map(y=>y.l));
  const body=s*(x.c-x.o),range=x.h-x.l,quality=body>=.35*a&&range>0&&
    (long?(x.h-x.c)/range<.32:(x.c-x.l)/range<.32);
  const avg=b.slice(i-20,i).reduce((sum,y)=>sum+y.v,0)/20;
  const volume=avg>0&&x.v>=avg*1.25;
  const all=trend&&pullback&&breakout&&quality&&volume;
  if(!all)return null;
  const seg=b.slice(i-6,i+1);
  const initialStop=long?Math.min(...seg.map(y=>y.l))-.12*a:Math.max(...seg.map(y=>y.h))+.12*a;
  if(!(s*(x.c-initialStop)>0))return null;
  return {i,t:x.t,side,close:x.c,stop:initialStop,atr:a,checks:{trend,pullback,breakout,quality,volume}};
 }
 function evaluate(input){
  const tf=input?.tf||'15m',sym=input?.sym||'',now=num(input?.now)||Date.now(),
    b=closed(input?.bars||[],tf,now);
  const base={strategyVersion:VERSION,tf,sym,side:'—',status:'none',score:0,price:b.at(-1)?.c||null,
    reason:'Not enough completed candles',stage:0,plan:null,firstAt:null,sweepAt:null,secondAt:null,analyzedAt:now};
  if(b.length<155)return base;
  // Distinct consecutive candles are mandatory: gaps must not create artificial breakouts.
  if(!contiguous(b.slice(-Math.min(170,b.length)),tf))
   return {...base,status:'unverified',reason:'Missing candles in recent history'};
  const ind=indicators(b,tf);let best=null,signal=null;
  const cutoff=Math.max(45,b.length-170);
  for(const side of ['long','short']){
   const long=side==='long',sg=long?1:-1;
   let first=null,sweep=null,lastCandidate=null;
   for(let i=cutoff;i<b.length;i++){
    const c=b[i],a=ind.atr[i]||0;
    if(first&&i-first.i>96){first=null;sweep=null;}
    if(first&&!sweep&&i>first.i){
     // Major structural level is calculated BEFORE the provisional confirmation.
     const ref=first.major;
     const breach=long?c.l<Math.min(first.stop,ref)-.05*a:c.h>Math.max(first.stop,ref)+.05*a;
     if(breach){
      sweep={i,t:c.t,wick:long?c.l:c.h,level:ref,reclaimed:long?c.c>ref:c.c<ref};
     }
    } else if(sweep&&i>sweep.i){
     // Widening stop-hunt wick extends the structural sweep, never enters.
     if(long?c.l<sweep.wick:c.h>sweep.wick){
      sweep.wick=long?c.l:c.h;sweep.i=i;sweep.t=c.t;
     }
     if(long?c.c>sweep.level:c.c<sweep.level)sweep.reclaimed=true;
     if(i-sweep.i>45){first=null;sweep=null;}
    }
    // Same complete formula is required after structural sweep + reclaim.
    const complete=setup(b,ind,i,side);
    if(first&&sweep&&sweep.reclaimed&&i>sweep.i&&complete){
     const stop=long?sweep.wick-.15*a:sweep.wick+.15*a;
     const risk=sg*(complete.close-stop);
     if(risk>0&&risk/complete.close>=.001&&risk/complete.close<=.30){
      const plan={entry:complete.close,stop,target:complete.close+sg*3*risk,
       rr:3,confirmedCandle:c.t,confirmedEnd:candleEnd(c.t,tf),
       firstAt:first.t,sweepAt:sweep.t,secondAt:c.t,sweepWick:sweep.wick,
       execution:'simulation only'};
      signal={...base,side,status:'confirm',score:100,price:c.c,stage:4,
       reason:'Second full confirmation completed after major structural sweep',
       firstAt:first.t,sweepAt:sweep.t,secondAt:c.t,plan,analyzedAt:now};
     }
     first=null;sweep=null;continue;
    }
    if(!first&&complete){
     // Major structure uses up to the 96 candles before first confirmation,
     // excluding the most recent six setup candles.
     const lookback=b.slice(Math.max(0,i-96),i-6);
     if(lookback.length<30)continue;
     const major=long?Math.min(...lookback.map(x=>x.l)):Math.max(...lookback.map(x=>x.h));
     first={...complete,major};
    }
   }
   if(first){
    const stage=sweep?(sweep.reclaimed?3:2):1;
    const candidate={...base,side,status:'watch',score:stage===1?33:stage===2?60:80,
      stage,firstAt:first.t,sweepAt:sweep?.t||null,
      reason:stage===1?'First full setup confirmed — awaiting major structural stop-area sweep':
             stage===2?'Major structural liquidity swept — awaiting reclaim':
                         'Major liquidity swept and reclaimed — awaiting same complete formula again'};
    if(!lastCandidate||candidate.score>lastCandidate.score)lastCandidate=candidate;
   }
   if(lastCandidate&&(!best||lastCandidate.score>best.score))best=lastCandidate;
  }
  if(signal){
   // Never surface an old historical confirmation as a current trade.
   const age=now-signal.plan.confirmedEnd;
   const maxAge=Math.min(TF_MS[tf]||86400000,6*3600000);
   if(age>=0&&age<=maxAge)return signal;
  }
  return best||{...base,reason:'Waiting for first complete confirmation'};
 }
 root.C36Engine=Object.freeze({VERSION,TF_MS,candleEnd,closed,evaluate});
})(typeof module!=='undefined'&&module.exports?module.exports:window);
