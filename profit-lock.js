'use strict';
/*
  Profit Lock — percentage of the PLANNED ENTRY→FINAL TP PRICE DISTANCE.
  Applies symmetrically for long and short. Not a percentage of account
  balance, leverage, or the underlying asset's current price.
  At >= 50% TP progress: stop protects 5% of planned profit range.
  At >= 75% TP progress: stop protects 50% of planned profit range.
  Stops may ONLY tighten and cannot be moved outside a valid entry/TP range.
  This utility computes levels only; it never places exchange orders.
*/
(function(root){
 function next({side,entry,stop,initialStop,tp,mark,stage=0}){
   const sg=side==='long'?1:side==='short'?-1:0;
   const e=Number(entry),s=Number(stop),s0=Number(initialStop),
     t=Number(tp),p=Number(mark);
   if(!sg||![e,s,s0,t,p].every(Number.isFinite)||
      Math.min(e,s,s0,t,p)<=0||sg*(t-e)<=0||sg*(e-s0)<=0)
     return {valid:false,stage:Math.max(0,Number(stage)||0),reason:'Invalid price levels'};
   const span=Math.abs(t-e),progress=sg*(p-e)/span;
   const previous=Math.max(0,Math.min(2,Math.trunc(Number(stage)||0)));
   const reached=progress>=.75?2:progress>=.5?1:0;
   const finalStage=Math.max(previous,reached);
   const lockFraction=finalStage===2?.5:finalStage===1?.05:null;
   const desired=lockFraction===null?s0:e+sg*lockFraction*span;
   const tighter=sg*(desired-s)>1e-10*e?desired:s;
   // Negative progress or a price already beyond the new stop cannot
   // justify replacing a protective exchange stop retroactively.
   const canApply=sg*(p-tighter)>Math.max(e*.00000005,0);
   return {valid:true,stage:finalStage,previousStage:previous,
     progress,desiredStop:desired,stop:tighter,
     changed:finalStage>previous&&sg*(tighter-s)>0,
     canApply,lockFraction,range:span};
 }
 root.ProfitLock=Object.freeze({next});
})(typeof module==='object'&&module.exports?module.exports:window);
