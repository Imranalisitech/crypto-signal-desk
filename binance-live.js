'use strict';
// LIVE Binance USDⓈ-M Futures connector for the local Windows laptop only.
// Production endpoint. Requires an explicit activation every app launch.
// No credentials or execution commands may be relayed through the public site.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const BASE='https://fapi.binance.com';
const DEFAULT_LIVE_CONFIG=Object.freeze({
  riskPerTradePct:0.2,maxNotionalUSDT:75,maxLeverage:2,
  maxOrdersPerDay:2,maxDailyLossPct:0.75,maxChasePct:0.2,
  maxStopPct:5,minNotionalUSDT:5
});
function liveConfig(v={},base={}){
  const source={...DEFAULT_LIVE_CONFIG,...base,...v};
  const out={};
  // Broad, individually editable limits for real-money risk management.
  // Broker/exchange safety and valid non-zero values cannot be disabled.
  const limits=[
    ['riskPerTradePct',.01,5],['maxNotionalUSDT',5,100000],
    ['maxLeverage',1,20],['maxOrdersPerDay',1,200],
    ['maxDailyLossPct',.1,20],['maxChasePct',.01,5],
    ['maxStopPct',.1,50],['minNotionalUSDT',1,1000]
  ];
  for(const [key,min,max] of limits){
    const n=Number(source[key]);
    if(!Number.isFinite(n)||n<min||n>max)
      throw Error(key+' must be between '+min+' and '+max+'; not saved');
    out[key]=n;
  }
  if(out.minNotionalUSDT>out.maxNotionalUSDT)
    throw Error('Minimum order notional cannot exceed maximum order notional');
  out.maxLeverage=Math.floor(out.maxLeverage);
  out.maxOrdersPerDay=Math.floor(out.maxOrdersPerDay);
  return out;
}
function windowsDpapi(mode,payload){
  if(process.platform!=='win32')throw Error('Secure Binance credentials require Windows DPAPI');
  const crypt=mode==='encrypt'?'Protect':'Unprotect';
  const decode=mode==='encrypt'?
    ' [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())':
    ' [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())';
  const emit=mode==='encrypt'?
    '[Convert]::ToBase64String($out)':
    '[Text.Encoding]::UTF8.GetString($out)';
  const command='$ErrorActionPreference="Stop";Add-Type -AssemblyName System.Security;'+
    '$raw='+decode+';'+
    '$out=[Security.Cryptography.ProtectedData]::'+crypt+
    '($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);'+
    '[Console]::Out.Write('+emit+');';
  return execFileSync('powershell.exe',
    ['-NoProfile','-NonInteractive','-Command',command],
    {input:payload,encoding:'utf8',maxBuffer:16*1024,windowsHide:true,timeout:15000}).trim();
}
class WindowsCredentialVault{
  constructor(dir){this.file=path.join(dir,'binance-live-credentials.dpapi')}
  exists(){return fs.existsSync(this.file)}
  save(apiKey,apiSecret){
    if(!/^[A-Za-z0-9]{16,200}$/.test(apiKey)||!/^[A-Za-z0-9]{16,200}$/.test(apiSecret))
      throw Error('Invalid API key/secret format');
    const ciphertext=windowsDpapi('encrypt',JSON.stringify({apiKey,apiSecret}));
    const tmp=this.file+'.tmp';
    fs.writeFileSync(tmp,ciphertext,{mode:0o600,flag:'w'});
    fs.renameSync(tmp,this.file);
    return true;
  }
  load(){
    if(!this.exists())throw Error('No locally encrypted Binance Futures credentials');
    const secrets=JSON.parse(windowsDpapi('decrypt',fs.readFileSync(this.file,'utf8')));
    if(!secrets.apiKey||!secrets.apiSecret)throw Error('Decryption failed');
    return secrets;
  }
  remove(){if(this.exists())fs.unlinkSync(this.file)}
}
class BinanceSignedApi{
 constructor({vault,request=fetch,base=BASE}={}){
  this.vault=vault;this.request=request;this.base=base;this.offset=0;this.synced=0;
 }
 async call(method,route,values={},signed=true){
  if(!route.startsWith('/fapi/'))throw Error('Disallowed Binance route');
  const params={...values};
  let cred=null;
  if(signed){
    cred=this.vault.load();
    if(Date.now()-this.synced>15*60000&&route!=='/fapi/v1/time')await this.syncClock();
    params.timestamp=Date.now()+this.offset;params.recvWindow=5000;
  }
  const query=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){
    if(v!==undefined&&v!==null)query.append(k,String(v));
  }
  const encoded=query.toString();
  const signature=signed?crypto.createHmac('sha256',cred.apiSecret).update(encoded).digest('hex'):null;
  const complete=encoded+(signature?(encoded?'&':'')+'signature='+signature:'');
  const url=this.base+route+(method==='GET'&&complete?'?'+complete:'');
  const response=await this.request(url,{
    method,headers:{
      'Accept':'application/json',
      ...(signed?{'X-MBX-APIKEY':cred.apiKey}:{'Content-Type':'application/json'}),
      ...(method!=='GET'?{'Content-Type':'application/x-www-form-urlencoded'}:{})
    },
    ...(method==='GET'?{}:{body:complete}),
    signal:AbortSignal.timeout(13000)
  });
  const raw=await response.text();
  let data;try{data=JSON.parse(raw)}catch(_){data={msg:'Invalid Binance response'}}
  if(!response.ok||data?.code<0){
    const code=Number.isFinite(Number(data?.code))?data.code:response.status;
    const reason=String(data?.msg||'Binance request failed').slice(0,160);
    throw Error('Binance '+code+': '+reason);
  }
  return data;
 }
 async syncClock(){
  const res=await this.request(this.base+'/fapi/v1/time',{
    method:'GET',signal:AbortSignal.timeout(10000)
  });
  if(!res.ok)throw Error('Binance timestamp check unavailable');
  const data=await res.json();
  if(!Number.isFinite(Number(data.serverTime)))throw Error('Invalid Binance server time');
  this.offset=Number(data.serverTime)-Date.now();this.synced=Date.now();
  if(Math.abs(this.offset)>20000)throw Error('Windows clock differs from Binance by more than 20 seconds');
 }
}
function quantize(value,step,dir='floor'){
  const n=Number(value),s=Number(step);
  if(!(n>0&&s>0))throw Error('Invalid market quantity or tick size');
  const precision=String(step).includes('e-')?Math.min(12,Number(String(step).split('e-')[1])) :
    Math.min(12,(String(step).split('.')[1]||'').length);
  const units=n/s;
  const whole=(dir==='ceil'?Math.ceil(units-1e-9):dir==='round'?Math.round(units):Math.floor(units+1e-9));
  return Number((whole*s).toFixed(precision));
}
function brokerDay(now=Date.now()){return new Date(now).toISOString().slice(0,10)}
class BinanceLiveBroker{
 constructor({dir,config={},state=null,api=null,persist=()=>{},log=()=>{},vault=null}={}){
  this.vault=vault||new WindowsCredentialVault(dir||process.cwd());
  this.api=api||new BinanceSignedApi({vault:this.vault});
  this.config=liveConfig(config);
  this.state=state&&typeof state==='object'?state:{};
  if(!Array.isArray(this.state.orders))this.state.orders=[];
  if(!Array.isArray(this.state.events))this.state.events=[];
  if(!this.state.keys||typeof this.state.keys!=='object')this.state.keys={};
  this.state.lastError=null;
  this.state.armed=false; // NEVER persist live activation across restarts.
  this.state.connected=false;
  this.state.lastVerify=null;
  this.state.lastCheck=null;
  this.persist=persist;this.log=log;
  this.busy=false;this.processing=Promise.resolve();
  this.symbols=null;this.symbolsAt=0;
  this.balanceInfo=null;this.positionCache=null;
 }
 record(event,data={}){
  const e={time:Date.now(),event,...data};
  this.state.events.push(e);
  if(this.state.events.length>500)this.state.events.shift();
  this.persist();
  this.log('BINANCE LIVE '+event+' '+JSON.stringify(data).slice(0,250));
 }
 disarm(reason='Manual pause'){
  this.state.armed=false;
  this.record('DISARMED',{reason});
 }
 async connect(apiKey,apiSecret){
  // Do not store invalid credentials. Check via signed read-only account first.
  if(!/^[A-Za-z0-9]{16,200}$/.test(apiKey)||!/^[A-Za-z0-9]{16,200}$/.test(apiSecret))
    throw Error('API key or secret is not a valid Binance Futures key');
  const testVault={load:()=>({apiKey,apiSecret})};
  const testApi=new BinanceSignedApi({vault:testVault,request:this.api.request,base:this.api.base});
  const account=await testApi.call('GET','/fapi/v3/account');
  const mode=await testApi.call('GET','/fapi/v1/positionSide/dual');
  if(mode.dualSidePosition!==false)throw Error('Live trading requires One-Way Position Mode (disable Hedge Mode on Binance first)');
  if(account.canTrade!==true)throw Error('Binance account does not allow Futures trading');
  this.vault.save(apiKey,apiSecret);
  this.state.connected=true;this.state.armed=false;
  this.state.lastVerify=Date.now();this.state.lastError=null;
  this.api.synced=0;this.record('CONNECTED',{last4:apiKey.slice(-4)});
  return this.status();
 }
 removeCredentials(){
  this.disarm('Credentials disconnected');
  this.vault.remove();this.state.connected=false;this.record('CREDENTIALS_REMOVED');
 }
 async verify(){
  if(!this.vault.exists())throw Error('Connect real Binance API credentials from the local desktop first');
  const account=await this.api.call('GET','/fapi/v3/account');
  const dual=await this.api.call('GET','/fapi/v1/positionSide/dual');
  if(dual.dualSidePosition!==false)throw Error('Binance Hedge Mode is unsupported; set One-Way Position Mode');
  if(account.canTrade!==true)throw Error('Futures account trading permission unavailable');
  const asset=account.assets?.find(x=>x.asset==='USDT');
  if(!asset)throw Error('USDT Futures asset balance not found');
  this.balanceInfo={
    walletBalance:Number(asset.walletBalance)||0,
    availableBalance:Number(asset.availableBalance)||0,
    unrealizedProfit:Number(asset.unrealizedProfit)||0
  };
  this.state.connected=true;this.state.lastVerify=Date.now();
  const now=Date.now();
  if(this.state.day!==brokerDay(now)){
    this.state.day=brokerDay(now);
    this.state.dayStartWallet=this.balanceInfo.walletBalance;
    this.state.dailyOrders=0;
  }
  this.persist();return this.balanceInfo;
 }
 async arm(phrase){
  if(phrase!=='ENABLE REAL BINANCE FUTURES AUTO TRADING')
    throw Error('Explicit live-trading confirmation phrase is required');
  await this.verify();
  const positions=await this.api.call('GET','/fapi/v2/positionRisk');
  if(!Array.isArray(positions))throw Error('Cannot verify Binance account positions');
  if(positions.some(x=>Math.abs(Number(x.positionAmt)||0)>0))
    throw Error('Close or manage existing Futures positions manually before activating automatic entries');
  if(this.state.orders.some(x=>['PENDING','UNPROTECTED','ACTIVE','UNKNOWN'].includes(x.status)))
    throw Error('Review unresolved previous Binance live orders before activating');
  this.state.armed=true;this.state.lastError=null;
  this.record('ARMED',{riskPct:this.config.riskPerTradePct,maxNotional:this.config.maxNotionalUSDT});
  return this.status();
 }
 status(){
  const active=this.state.orders.filter(x=>['PENDING','UNPROTECTED','ACTIVE','UNKNOWN'].includes(x.status));
  const creds=this.vault.exists();
  return {
    mode:'BINANCE LIVE — REAL FUNDS',provider:'Binance USD-M Futures production',
    connected:!!this.state.connected&&creds,credentialsSaved:creds,
    armed:this.state.armed,verifiedAt:this.state.lastVerify,
    config:this.config,balance:this.balanceInfo,orders:this.state.orders.slice(-80),
    events:this.state.events.slice(-40),activeCount:active.length,
    day:this.state.day,dayStartWallet:this.state.dayStartWallet,
    dailyOrders:this.state.dailyOrders||0,lastError:this.state.lastError,
    warning:'Real USDT margin and liquidation risks. Emergency pause blocks new trades only.'
  };
 }
 changeConfig(incoming={}){
  if(this.state.armed)throw Error('Pause live execution before changing risk limits');
  this.config=liveConfig(incoming,this.config);this.persist();
  return this.config;
 }
 async getSymbols(){
  if(this.symbols&&Date.now()-this.symbolsAt<60*60000)return this.symbols;
  const raw=await this.api.call('GET','/fapi/v1/exchangeInfo',{},false);
  const symbols=new Map();
  for(const s of raw.symbols||[]){
    if(s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT')
      symbols.set(s.symbol,s);
  }
  this.symbols=symbols;this.symbolsAt=Date.now();return symbols;
 }
 onSignal(signal,source,mark){
  this.processing=this.processing.then(()=>this.execute(signal,source,mark))
    .catch(e=>{
      this.state.lastError=String(e.message).slice(0,180);
      this.disarm('Live execution error: '+this.state.lastError);
      return {accepted:false,reason:this.state.lastError};
    });
  return this.processing;
 }
 async execute(signal,source,mark){
  if(!this.state.armed||!this.vault.exists())return {accepted:false,reason:'Live execution disabled'};
  if(source!=='binance')return {accepted:false,reason:'Live execution requires Binance-based signal data'};
  if(!signal||signal.status!=='confirm'||!signal.plan)return {accepted:false,reason:'Not a confirmed strategy signal'};
  if(signal.executionReady!==true||signal.plan.researchOnly===true)
    return {accepted:false,reason:'Unvalidated signal cannot place real Binance orders'};
  const sym=signal.sym,dir=signal.dir,sg=dir==='long'?1:dir==='short'?-1:0;
  const ck=Number(signal.plan.ck),key=[source,sym,dir,ck].join(':');
  const now=Date.now();
  if(!sg||!/^[A-Z0-9]{3,30}$/.test(sym)||!(ck>0))return {accepted:false,reason:'Invalid trade'};
  if(this.state.keys[key])return {accepted:false,reason:'Already processed confirmation candle'};
  const m=Number(mark?.p),at=Number(mark?.at);
  if(!(m>0&&now-at<30_000))return {accepted:false,reason:'Binance market price stale'};
  if(ck>now||now-(ck+300_000)>9*60_000)return {accepted:false,reason:'Signal confirmation too old'};
  if((this.state.dailyOrders||0)>=this.config.maxOrdersPerDay)return {accepted:false,reason:'Daily order-count limit'};
  if(this.state.orders.some(x=>['PENDING','UNPROTECTED','ACTIVE','UNKNOWN'].includes(x.status)))
    return {accepted:false,reason:'Existing live position or unresolved order'};
  const plan=signal.plan,en=Number(plan.en),stop=Number(plan.stop),target=Number(plan.tp2);
  if(![en,stop,target].every(x=>Number.isFinite(x)&&x>0))
    return {accepted:false,reason:'Invalid signal price levels'};
  if(sg*(en-stop)<=0||Math.abs((target-en)/(en-stop)-3)>.03)
    return {accepted:false,reason:'Signal stop/target fails 3R validation'};
  const chase=Math.abs(m-en)/en*100;
  if(chase>this.config.maxChasePct)return {accepted:false,reason:'Binance mark price moved too far from entry'};
  if(sg*(m-stop)<=0)return {accepted:false,reason:'Stop is beyond current market'};
  if(Math.abs(m-stop)/m*100>this.config.maxStopPct)
    return {accepted:false,reason:'Real-money broker risk: structural stop too wide'};
  const balance=await this.verify();
  if(balance.walletBalance<=0||balance.availableBalance<10)
    return {accepted:false,reason:'Insufficient USDT Futures available margin'};
  if(balance.walletBalance+balance.unrealizedProfit<this.state.dayStartWallet*(1-this.config.maxDailyLossPct/100)){
    this.disarm('Daily account loss protection');return {accepted:false,reason:'Daily-loss lock'};
  }
  const dual=await this.api.call('GET','/fapi/v1/positionSide/dual');
  if(dual.dualSidePosition!==false)throw Error('Hedge Mode detected, disabling auto trading');
  const positions=await this.api.call('GET','/fapi/v2/positionRisk');
  if(!Array.isArray(positions)||positions.some(x=>Math.abs(Number(x.positionAmt)||0)>0))
    return {accepted:false,reason:'Futures account has an existing position'};
  const rule=(await this.getSymbols()).get(sym);
  if(!rule)return {accepted:false,reason:'Binance Futures symbol not available for trading'};
  const lot=rule.filters.find(x=>x.filterType==='MARKET_LOT_SIZE')||
    rule.filters.find(x=>x.filterType==='LOT_SIZE');
  const tick=rule.filters.find(x=>x.filterType==='PRICE_FILTER')?.tickSize;
  if(!lot||!tick)throw Error('Binance Futures precision filters unavailable');
  const stopDist=Math.abs(m-stop);
  const riskBudget=balance.walletBalance*this.config.riskPerTradePct/100;
  const notional=Math.min(riskBudget*m/stopDist,
    this.config.maxNotionalUSDT,balance.availableBalance*this.config.maxLeverage*.8);
  const qty=quantize(notional/m,lot.stepSize);
  const minQty=Number(lot.minQty)||0;
  const minNotional=Math.max(this.config.minNotionalUSDT,
    Number(rule.filters.find(x=>x.filterType==='MIN_NOTIONAL')?.notional)||5);
  if(qty<minQty||qty*m<minNotional||qty*m>this.config.maxNotionalUSDT)
    return {accepted:false,reason:'Trade too small for Binance rules or risk budget'};
  const exit=dir==='long'?'SELL':'BUY',side=dir==='long'?'BUY':'SELL';
  // Quantize thresholds against the trigger direction. No threshold may
  // move closer than intended (prefer a wider protective stop).
  const sl=quantize(stop,tick,dir==='long'?'floor':'ceil');
  if(!(sg*(m-sl)>0))return {accepted:false,reason:'Stop trigger invalid'};
  if(!this.state.armed)return {accepted:false,reason:'Disarmed'};
  const clientId='csd'+crypto.createHash('sha256').update(key).digest('hex').slice(0,26);
  // Persist BEFORE any real order request. On ambiguous timeout or restart,
  // do not resubmit this confirmation candle.
  const item={key,sym,dir,clientId,createdAt:Date.now(),entrySignal:en,
    sl,tpTarget:target,qty,notional:qty*m,status:'PENDING'};
  this.state.orders.push(item);this.state.keys[key]=Date.now();
  this.persist();this.record('ENTRY_REQUESTED',{sym,dir,notional:item.notional});
  this.state.dailyOrders=(this.state.dailyOrders||0)+1;
  // Account setting calls are explicit parts of the real activation; only
  // isolated margin and capped leverage are used.
  try{
    try{await this.api.call('POST','/fapi/v1/marginType',{symbol:sym,marginType:'ISOLATED'})}
    catch(e){if(!String(e.message).includes('-4046'))throw e}
    await this.api.call('POST','/fapi/v1/leverage',{symbol:sym,leverage:this.config.maxLeverage});
    const fill=await this.api.call('POST','/fapi/v1/order',{
      symbol:sym,side,positionSide:'BOTH',type:'MARKET',
      quantity:qty,newClientOrderId:clientId,newOrderRespType:'RESULT'
    });
    const avg=Number(fill.avgPrice),filled=Number(fill.executedQty);
    if(!(avg>0&&filled>0))throw Error('Market entry not confirmed FILLED; manual Binance order review required');
    item.status='UNPROTECTED';item.orderId=fill.orderId;item.entry=avg;item.filledQty=filled;
    item.tp=quantize(avg+sg*3*Math.abs(avg-sl),tick,dir==='long'?'ceil':'floor');
    this.persist();this.record('ENTRY_FILLED',{sym,side,price:avg,quantity:filled});
    const stopAlgo=await this.api.call('POST','/fapi/v1/algoOrder',{
      algoType:'CONDITIONAL',symbol:sym,side:exit,positionSide:'BOTH',
      type:'STOP_MARKET',triggerPrice:sl,workingType:'MARK_PRICE',closePosition:'true',
      clientAlgoId:clientId.slice(0,24)+'SL'
    });
    item.slAlgoId=stopAlgo.algoId;this.persist();
    const take=await this.api.call('POST','/fapi/v1/algoOrder',{
      algoType:'CONDITIONAL',symbol:sym,side:exit,positionSide:'BOTH',
      type:'TAKE_PROFIT_MARKET',triggerPrice:item.tp,
      workingType:'MARK_PRICE',closePosition:'true',
      clientAlgoId:clientId.slice(0,24)+'TP'
    });
    item.tpAlgoId=take.algoId;item.status='ACTIVE';this.persist();
    this.record('PROTECTED',{sym,sl,tp:item.tp,orderId:item.orderId});
    return {accepted:true,order:item};
  }catch(error){
    const reason=String(error.message).slice(0,180);
    this.disarm('Live order/protection failure: '+reason);
    item.error=reason;item.status=item.status==='PENDING'?'UNKNOWN':'UNPROTECTED';
    this.persist();this.record('CRITICAL_ORDER_ERROR',{sym,reason,
      action:'Check the actual Binance position and protective orders immediately'});
    // Do not automatically retry an ambiguous market entry; duplicate buys
    // can be much worse. If the filled position is known and lacks protection,
    // make ONE reduce-only close attempt before requiring manual inspection.
    if(item.status==='UNPROTECTED'&&item.filledQty>0){
      try{
        await this.api.call('POST','/fapi/v1/order',{
          symbol:sym,side:exit,positionSide:'BOTH',type:'MARKET',
          quantity:item.filledQty,reduceOnly:'true',
          newClientOrderId:clientId.slice(0,24)+'SAFE'
        });
        item.status='EMERGENCY_CLOSE_REQUESTED';
        this.record('EMERGENCY_FLATTEN_SENT',{sym,reason});
      }catch(err){
        this.record('EMERGENCY_FLATTEN_FAILED',{sym,error:String(err.message).slice(0,130)});
      }
    }
    return {accepted:false,reason:'CRITICAL: '+reason+'; inspect Binance positions'};
  }
 }
 async reconcile(){
  if(!this.vault.exists()||!this.state.orders.some(x=>x.status==='ACTIVE'))return;
  const live=this.state.orders.filter(x=>x.status==='ACTIVE');
  try{
    const positions=await this.api.call('GET','/fapi/v2/positionRisk');
    if(!Array.isArray(positions))throw Error('Position status response invalid');
    for(const t of live){
      const found=positions.find(x=>x.symbol===t.sym);
      if(!found||Math.abs(Number(found.positionAmt)||0)===0){
        t.status='CLOSED';t.closedAt=Date.now();
        t.outcome='Binance confirms position flat; inspect real trade history for realized P&L';
        for(const algo of [t.slAlgoId,t.tpAlgoId]){
          if(algo!=null){
            try{await this.api.call('DELETE','/fapi/v1/algoOrder',{algoId:algo,symbol:t.sym})}
            catch(_){}
          }
        }
        this.record('POSITION_CLOSED',{sym:t.sym});
      }else if(Date.now()-t.createdAt>=4*3600000){
        // The original signal system has a four-hour exit. Binance-side
        // protective SL/TP remains in place even if the laptop sleeps.
        const amount=Math.abs(Number(found.positionAmt));
        if(Math.abs(amount-Number(t.filledQty))>Math.max(0.00000001,Number(t.filledQty)*.001)){
          this.disarm('Binance position size changed outside this app; check the account manually');
          continue;
        }
        if(!t.timeExitRequestedAt){
          t.timeExitRequestedAt=Date.now();this.persist();
          try{
            const exit=t.dir==='long'?'SELL':'BUY';
            await this.api.call('POST','/fapi/v1/order',{
              symbol:t.sym,side:exit,positionSide:'BOTH',type:'MARKET',
              quantity:amount,reduceOnly:'true',
              newClientOrderId:t.clientId.slice(0,24)+'TIME'
            });
            this.record('FOUR_HOUR_TIME_EXIT_SENT',{sym:t.sym});
          }catch(error){
            this.disarm('4h reduce-only close failed: '+String(error.message).slice(0,100));
          }
        }else if(Date.now()-t.timeExitRequestedAt>60000){
          this.disarm('Four-hour time exit not yet confirmed; verify Binance position');
        }
      }
    }
    this.state.lastCheck=Date.now();
    this.persist();
  }catch(e){
    this.state.lastError='Reconciliation failed: '+String(e.message).slice(0,140);
    this.disarm(this.state.lastError);
  }
 }
}
module.exports={BinanceLiveBroker,WindowsCredentialVault,BinanceSignedApi,liveConfig,quantize,DEFAULT_LIVE_CONFIG};
