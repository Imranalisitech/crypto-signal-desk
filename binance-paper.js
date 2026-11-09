'use strict';
// Binance USDⓈ-M Futures LOCAL PAPER BROKER.
// NO authenticated exchange requests, NO Binance order endpoints, NO real trades.
// Signal qualifications are provided by unified-strategy.js and are untouched.
const DEFAULT_PAPER_CONFIG=Object.freeze({
  enabled:true,paused:false,startingBalance:10000,riskPerTradePct:0.5,
  maxOpenPositions:3,maxPositionNotional:3000,maxTotalNotional:10000,
  maxGrossLeverage:3,dailyLossLimitPct:2,feePerSidePct:0.04,
  slippagePct:0.02,maxMarkDeviationPct:0.5,minPositionNotional:20
});
const finite=Number.isFinite;
function numberIn(value,fallback,low,high){
  const n=Number(value);
  return finite(n)&&n>=low&&n<=high?n:fallback;
}
function normalizePaperConfig(candidate={},previous={}){
  const raw={...DEFAULT_PAPER_CONFIG,...previous,...candidate};
  const out={enabled:raw.enabled!==false,paused:raw.paused===true};
  for(const [key,min,max] of [
    ['startingBalance',100,1e9],['riskPerTradePct',0.01,5],
    ['maxOpenPositions',1,30],['maxPositionNotional',20,1e9],
    ['maxTotalNotional',50,1e10],['maxGrossLeverage',1,20],
    ['dailyLossLimitPct',0.1,20],['feePerSidePct',0,1],
    ['slippagePct',0,1],['maxMarkDeviationPct',0.01,5],
    ['minPositionNotional',1,100000]
  ]){
    out[key]=numberIn(raw[key],DEFAULT_PAPER_CONFIG[key],min,max);
  }
  out.maxOpenPositions=Math.floor(out.maxOpenPositions);
  out.maxTotalNotional=Math.max(out.maxPositionNotional,out.maxTotalNotional);
  return out;
}
function newPaperState(){
  return {mode:'binance-local-paper',version:1,open:[],history:[],rejections:[],
    processedKeys:{},startedAt:Date.now(),lastMarkAt:null,lastOrderAt:null,feedError:null};
}
function paperToday(timestamp){return new Date(timestamp).toISOString().slice(0,10)}
function isSignalKey(key){return typeof key==='string'&&/^(bybit|binance):[A-Z0-9]{3,30}:(long|short):\d+$/.test(key)}
class BinancePaperBroker{
  constructor({config={},state=null,persist=()=>{},log=()=>{}}={}){
    this.config=normalizePaperConfig(config);
    this.state=state&&typeof state==='object'?state:newPaperState();
    for(const p of ['open','history','rejections'])if(!Array.isArray(this.state[p]))this.state[p]=[];
    if(!this.state.processedKeys||typeof this.state.processedKeys!=='object'||Array.isArray(this.state.processedKeys))
      this.state.processedKeys={};
    for(const item of [...this.state.open,...this.state.history,...this.state.rejections]){
      if(isSignalKey(item.signalKey))this.state.processedKeys[item.signalKey]=item.open||item.at||Date.now();
    }
    this.persist=persist;this.log=log;this.marks={};
  }
  setConfig(data={}){
    const before=this.config;
    this.config=normalizePaperConfig(data,before);
    // Starting virtual balance must never change after an order is recorded:
    // resetting after losses would conceal the paper account's performance.
    if((this.state.open.length||this.state.history.length)&&
        this.config.startingBalance!==before.startingBalance)
      this.config.startingBalance=before.startingBalance;
    this.persist();return this.config;
  }
  setMarks(list,time=Date.now()){
    if(!Array.isArray(list))throw Error('Expected a Binance mark-price array');
    let count=0;
    for(const item of list){
      const symbol=String(item.symbol||''),price=Number(item.markPrice??item.p??item.price);
      if(/^[A-Z0-9]{3,30}$/.test(symbol)&&finite(price)&&price>0){
        this.marks[symbol]={p:price,at:time};count++;
      }
    }
    if(count){
      this.state.lastMarkAt=time;this.state.feedError=null;
    }
    return count;
  }
  mark(symbol,now=Date.now()){
    const item=this.marks[symbol];
    return item&&item.p>0&&now-item.at<=45_000?item.p:null;
  }
  balance(){
    return this.config.startingBalance+this.state.history.reduce((sum,t)=>sum+(Number(t.pnl)||0),0);
  }
  notionalOpen(){
    return this.state.open.reduce((sum,t)=>sum+Number(t.notional||0),0);
  }
  unrealized(){
    const fees=this.config.feePerSidePct/100;
    return this.state.open.reduce((sum,t)=>{
      const mark=this.mark(t.sym);
      if(!mark)return sum;
      const sg=t.dir==='long'?1:-1;
      return sum+sg*(mark-t.en)*t.qty-(mark+t.en)*t.qty*fees;
    },0);
  }
  dailyPnl(now=Date.now()){
    const day=paperToday(now);
    return this.state.history.filter(t=>paperToday(t.close)===day)
      .reduce((sum,t)=>sum+(Number(t.pnl)||0),0);
  }
  dayStartBalance(now=Date.now()){
    return this.balance()-this.dailyPnl(now);
  }
  reject(key,signal,reason,time=Date.now()){
    if(isSignalKey(key))this.state.processedKeys[key]=time;
    this.state.rejections.push({id:'R'+time+'-'+this.state.rejections.length,
      signalKey:key||null,sym:signal?.sym||null,dir:signal?.dir||null,
      at:time,reason:String(reason),source:'binance-local-paper'});
    this.persist();this.log('PAPER REJECT '+(signal?.sym||'unknown')+' '+reason);
    return {accepted:false,reason};
  }
  onSignal(signal,source='bybit',now=Date.now()){
    if(!signal||signal.status!=='confirm'||!signal.plan)return {accepted:false,reason:'No confirmed trade'};
    const sym=String(signal.sym||''),dir=signal.dir,sg=dir==='long'?1:dir==='short'?-1:0;
    const ck=Number(signal.plan.ck);
    const key=[source,sym,dir,ck].join(':');
    if(!isSignalKey(key)||!sg)return this.reject(null,signal,'Invalid confirmation identity',now);
    if(this.state.processedKeys[key])return {accepted:false,reason:'Already processed (same confirmation candle)'};
    const cfg=this.config,price=this.mark(sym,now);
    if(!cfg.enabled)return this.reject(key,signal,'Paper execution disabled',now);
    if(cfg.paused)return this.reject(key,signal,'Paper trading paused',now);
    if(!price)return this.reject(key,signal,'Binance mark price unavailable or stale',now);
    if(!finite(ck)||ck<=0||ck>now||now-(ck+300_000)>12*60_000)
      return this.reject(key,signal,'Confirmation candle is stale',now);
    if(this.state.open.length>=cfg.maxOpenPositions)
      return this.reject(key,signal,'Maximum simultaneous paper positions reached',now);
    if(this.state.open.some(t=>t.sym===sym))
      return this.reject(key,signal,'Paper position for coin already open',now);
    const dayStart=this.dayStartBalance(now),balance=this.balance(),equity=balance+this.unrealized();
    if(!(dayStart>0&&balance>0&&equity>0))
      return this.reject(key,signal,'Virtual paper equity depleted',now);
    if(equity<=dayStart*(1-cfg.dailyLossLimitPct/100))
      return this.reject(key,signal,'Paper account daily loss protection active',now);
    const plan=signal.plan,reference=Number(plan.en),stop=Number(plan.stop),target=Number(plan.tp2);
    if(![reference,stop,target].every(x=>finite(x)&&x>0))
      return this.reject(key,signal,'Trade plan missing valid entry/SL/TP',now);
    const referenceRR=Math.abs(target-reference)/Math.abs(reference-stop);
    if(!finite(referenceRR)||Math.abs(referenceRR-3)>.05)
      return this.reject(key,signal,'Signal plan is not 1:3 risk/reward',now);
    const deviation=Math.abs(price-reference)/reference*100;
    if(deviation>cfg.maxMarkDeviationPct)
      return this.reject(key,signal,'Binance mark differs from signal entry by '+deviation.toFixed(2)+'%',now);
    const slip=cfg.slippagePct/100,fill=price*(1+sg*slip);
    if(sg*(fill-stop)<=0)return this.reject(key,signal,'Structural SL is on wrong side of Binance entry',now);
    const riskUnit=Math.abs(fill-stop),stopPct=riskUnit/fill*100;
    const openExposure=this.notionalOpen(),budget=Math.min(balance,equity)*cfg.riskPerTradePct/100;
    const capacity=Math.min(cfg.maxPositionNotional,cfg.maxTotalNotional-openExposure,
      equity*cfg.maxGrossLeverage-openExposure);
    const plannedNotional=budget/riskUnit*fill;
    const notional=Math.min(plannedNotional,capacity);
    if(!(notional>=cfg.minPositionNotional&&finite(notional)))
      return this.reject(key,signal,'Position too small after independent exposure limits',now);
    const quantity=notional/fill,stopRisk=quantity*riskUnit;
    const tp=fill+sg*3*riskUnit;
    if(!(quantity>0&&tp>0&&finite(tp)))
      return this.reject(key,signal,'Computed paper order invalid',now);
    const order={
      id:'P'+now+'-'+Math.random().toString(36).slice(2,8),
      signalKey:key,sym,dir,source:'binance',mode:'local-paper',
      signalSource:source,signalCandle:ck,
      en:fill,referenceEntry:reference,stop,stop0:stop,tp2:tp,tp:tp,
      qty:quantity,notional,riskUsd:stopRisk,sp:stopPct,rr:3,
      open:now,feePerSidePct:cfg.feePerSidePct,slippagePct:cfg.slippagePct,
      status:'paper-open',why:null
    };
    this.state.open.push(order);this.state.processedKeys[key]=now;
    this.state.lastOrderAt=now;this.persist();
    this.log('PAPER BUY/SELL SIMULATED '+dir.toUpperCase()+' '+sym+
      ' entry='+fill+' SL='+stop+' TP='+tp+' notional='+notional.toFixed(2));
    return {accepted:true,trade:order};
  }
  settle(t,why,trigger,mark,now){
    const sg=t.dir==='long'?1:-1,slip=(t.slippagePct??this.config.slippagePct)/100;
    let execution;
    if(why==='SL')execution=sg===1?Math.min(mark,trigger)*(1-slip):Math.max(mark,trigger)*(1+slip);
    else if(why==='TP')execution=trigger*(1-sg*slip);
    else execution=mark*(1-sg*slip);
    execution=Math.max(1e-12,execution);
    const gross=sg*(execution-t.en)*t.qty;
    const fees=(t.en+execution)*t.qty*(t.feePerSidePct??this.config.feePerSidePct)/100;
    const pnl=gross-fees,r=pnl/t.riskUsd;
    const result={...t,close:now,ex:execution,grossPnl:gross,fees,pnl,r,
      why:why==='SL'?'Paper stop-loss hit':why==='TP'?'Paper 3R target hit':'Paper 4-hour time exit',
      status:'paper-closed'};
    this.state.history.push(result);
    this.state.open=this.state.open.filter(x=>x.id!==t.id);
    this.persist();
    this.log('PAPER RESULT '+t.sym+' '+why+' '+pnl.toFixed(2)+' USDT / '+r.toFixed(3)+'R');
    return result;
  }
  monitor(now=Date.now()){
    let settled=0;
    for(const t of [...this.state.open]){
      const mark=this.mark(t.sym,now);
      // Never infer stops or targets from missing/stale prices.
      if(!mark)continue;
      const sg=t.dir==='long'?1:-1;
      if(sg*(mark-t.stop)<=0){this.settle(t,'SL',t.stop,mark,now);settled++;}
      else if(sg*(mark-t.tp2)>=0){this.settle(t,'TP',t.tp2,mark,now);settled++;}
      else if(now-t.open>=4*3600000){this.settle(t,'TIME',mark,mark,now);settled++;}
    }
    return settled;
  }
  summary(now=Date.now()){
    const closed=this.state.history,winners=closed.filter(x=>x.pnl>0);
    const balance=this.balance(),floating=this.unrealized();
    return {
      mode:'BINANCE FUTURES — LOCAL PAPER ONLY',liveOrdersEnabled:false,
      enabled:this.config.enabled,paused:this.config.paused,
      accountBalance:balance,unrealizedPnl:floating,equity:balance+floating,
      dailyPnl:this.dailyPnl(now),openCount:this.state.open.length,
      closedCount:closed.length,rejectedCount:this.state.rejections.length,
      winRate:closed.length?winners.length/closed.length*100:0,
      exposure:this.notionalOpen(),lastMarkAt:this.state.lastMarkAt,
      lastOrderAt:this.state.lastOrderAt,feedError:this.state.feedError
    };
  }
  snapshot(includeAll=true){
    const history=includeAll?this.state.history:this.state.history.slice(-300);
    const rejections=includeAll?this.state.rejections:this.state.rejections.slice(-80);
    return {config:{...this.config},summary:this.summary(),open:this.state.open,
      history,rejections,historyTotal:this.state.history.length,
      rejectionTotal:this.state.rejections.length,
      historyTruncated:history.length<this.state.history.length,
      marksUpdatedAt:this.state.lastMarkAt};
  }
}
module.exports={BinancePaperBroker,DEFAULT_PAPER_CONFIG,normalizePaperConfig,newPaperState};
