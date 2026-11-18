'use strict';
// Real Binance account controls run ONLY in the Windows localhost dashboard.
// Never transmit Binance credentials to Render, GitHub or browser storage.
(function(){
 const panel=document.getElementById('realBinancePanel');
 if(!panel)return;
 const local=window.CRYPTO_LOCAL_SERVER===true;
 panel.hidden=false;
 if(!local){
   // Real trading requires private, authenticated local agent.
   // Never collect, persist or forward exchange API secrets in the public browser.
   const $=id=>document.getElementById(id);
   const creds=$('liveCredentials');
   const controls=document.querySelector('#realBinancePanel .paper-status[style*="background:#3d2631"]');
   if(creds)creds.hidden=true;
   if(controls)controls.hidden=true;
   $('liveStatus').textContent='REAL TRADING DASHBOARD — Secure Binance agent not connected. Live order execution locked.';
   $('liveStatus').style.background='#233647';
   $('liveReadinessText').textContent='Private account link required · account balance and P&L not verified · orders locked';
   $('liveBalance').innerHTML=[
    ['Binance account','Not connected'],['Real wallet (USDT)','Unavailable'],
    ['Available margin (USDT)','Unavailable'],['Daily realized loss','Unavailable'],
    ['Live positions','Not connected'],['Order execution','Locked']
   ].map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('');
   $('liveOrders').textContent='Connect the secure Windows trading agent to retrieve actual Binance Futures positions and orders.';
   $('liveEvents').textContent='No live account audit available without a secure connection.';
   $('liveOrderCount').textContent='Not connected';
   $('liveRefreshAccount').addEventListener('click',()=>{
     const setup=$('secureBrokerSetup');
     if(setup){setup.open=true;setup.scrollIntoView({behavior:'smooth',block:'center'});}
     $('liveStatus').textContent='Open the private Binance dashboard on your own Windows PC to enter an API key. The public site never receives exchange secrets.';
   });
   const localLauncher=$('openPrivateBinance');
   if(localLauncher)localLauncher.addEventListener('click',()=>{
     window.open('http://127.0.0.1:8765/','_blank','noopener,noreferrer');
     $('liveStatus').textContent='Attempted to open the private local dashboard. If the address is unavailable, download and run the private agent on this Windows PC first.';
   });
   const title=$('liveRiskSettings').querySelector('summary');
   title.textContent='Real trading allocation and risk limits';
   $('liveRiskSettings').querySelector('p.paper-note').textContent=
     'Configure the proposed leverage, margin, risk, trade-count and daily-loss limits. They are saved on this device, but will not control live Binance orders until a verified private execution engine accepts and enforces them.';
   const storeKey='crypto_signal_desk_browser_live_risk_draft_v1';
   let saved=null;try{saved=JSON.parse(localStorage.getItem(storeKey)||'null')}catch(_){}
   const allowed=['maxLeverage','tradeMarginUSDT','riskPerTradePct','maxOrdersPerDay','maxDailyLossUSD'];
   const bounds={maxLeverage:[1,125],tradeMarginUSDT:[1,100000],
     riskPerTradePct:[0.01,5],maxOrdersPerDay:[1,1000],maxDailyLossUSD:[0.01,1000000]};
   for(const el of document.querySelectorAll('[data-live-setting]')){
     if(saved&&allowed.includes(el.dataset.liveSetting)&&Number.isFinite(saved[el.dataset.liveSetting]))
       el.value=String(saved[el.dataset.liveSetting]);
   }
   const message=$('liveRiskDraft');
   message.textContent='Local risk preferences are editable. These values are not enforced by Binance until secure live integration is verified.';
   $('liveSaveRisk').textContent='Save real-trading risk preferences';
   $('liveSaveRisk').addEventListener('click',()=>{
     const next={};
     for(const key of allowed){
       const el=document.querySelector('[data-live-setting="'+key+'"]');
       const raw=el.value.trim(),value=Number(raw),[lo,hi]=bounds[key];
       const whole=key==='maxLeverage'||key==='maxOrdersPerDay';
       if(!raw||!Number.isFinite(value)||value<lo||value>hi||(whole&&!Number.isSafeInteger(value))){
         message.textContent='Not saved: '+key+' must be '+lo+' to '+hi+(whole?' (whole number)':'')+'.';
         el.focus();return;
       }
       next[key]=value;
     }
     try{
       localStorage.setItem(storeKey,JSON.stringify(next));
       message.textContent='Risk preferences saved locally. Daily loss limit: $'+next.maxDailyLossUSD.toFixed(2)+
         '. No live order protection is active until connected and verified.';
     }catch(_){message.textContent='Risk preferences could not be saved on this device.';}
   });
   return;
 }
 const $=id=>document.getElementById(id);
 const launch=$('openPrivateBinance');if(launch)launch.hidden=true;
 const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{
   minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 let status=null,busy=false,msg='',settingsDirty=false;
 function update(){
  if(!status)return;
  const armed=status.armed===true,connected=status.connected===true;
  const saved=status.credentialsSaved===true;
  $('liveStatus').textContent=(armed?'LIVE AUTO TRADING ON — REAL FUNDS AT RISK':
    connected?'Real Binance account connected and VERIFIED — live orders OFF':
    saved?'Encrypted Binance credentials saved — verify to connect; trading OFF':
    'Real Binance account not connected — trading OFF')+
    (status.lastError?' · '+status.lastError:'')+(msg?' · '+msg:'');
  $('liveStatus').style.background=armed?'#7a2431':'#233647';
  if(connected&&$('secureBrokerSetup'))$('secureBrokerSetup').open=false;
  $('liveReadinessText').textContent=armed?'LIVE TRADING ARMED — monitor exchange positions continuously':
    connected?(status.executionReady&&status.dailyLossGuardReady&&status.protectiveOrdersReady?
      'Private execution engine verified · daily-loss & protective-order guards ready · manual activation required':
      'Account verified · execution locked until live risk safeguards are verified'):
    'Private account connection required · orders locked';
  const b=status.balance;
  $('liveBalance').innerHTML=[
    ['Real account',connected?'Verified':'Not verified'],
    ['Available USDT',b?num(b.availableBalance):'—'],
    ['Futures wallet USDT',b?num(b.walletBalance):'—'],
    ['Real orders placed today',status.dailyOrders||0],
    ['Tracked real orders',status.orders?.length||0],
    ['Daily loss limit (USD)',status.config?.maxDailyLossUSD==null?'Not configured':num(status.config.maxDailyLossUSD)]
  ].map(x=>'<div><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');
  for(const input of document.querySelectorAll('[data-live-setting]')){
    // Polls occur every 12 seconds. Never overwrite a pending user edit,
    // even after the field loses focus.
    if(!settingsDirty&&document.activeElement!==input&&
       status.config?.[input.dataset.liveSetting]!=null)
      input.value=String(status.config[input.dataset.liveSetting]);
    input.disabled=busy||armed;
  }
  // Only enable arming when the private server explicitly advertises verified
  // live-trading support and confirmed daily-loss & order-protection enforcement.
  const executionReady=connected&&status.executionReady===true&&
    status.dailyLossGuardReady===true&&status.protectiveOrdersReady===true;
  $('liveArm').disabled=busy||armed||!executionReady;
  $('liveDisarm').disabled=busy||!armed;
  $('liveArmPhrase').disabled=busy||armed||!executionReady;
  $('liveConnect').disabled=busy||armed;
  $('liveVerify').disabled=busy||!saved;
  $('liveDisconnect').disabled=busy||armed||!saved;
  $('liveSaveRisk').disabled=busy||armed;
  const orders=Array.isArray(status.orders)?status.orders:[];
  $('liveOrderCount').textContent=orders.length+' entries';
  const td=s=>'<td>'+h(s)+'</td>';
  $('liveOrders').innerHTML=orders.length?
    '<table><tr><th>Time</th><th>Coin</th><th>Side</th><th>Status</th><th>Real entry</th><th>Current SL</th><th>Final TP</th><th>Lock stage</th><th>Margin allocated</th><th>Risk budget</th><th>Issue</th></tr>'+
    [...orders].reverse().map(x=>'<tr>'+td(x.createdAt?new Date(x.createdAt).toLocaleString():'—')+
      td(x.sym)+td(x.dir)+td(x.status)+td(x.entry==null?'—':num(x.entry,6))+
      td(x.sl==null?'—':num(x.sl,6))+td(x.tp==null?'—':num(x.tp,6))+
      td((x.profitLockStage||0)===2?'75% of TP reached → 50% profit range locked':
         (x.profitLockStage||0)===1?'50% of TP reached → 5% profit range locked':'Initial SL')+
      td(x.allocationUSDT==null?'—':num(x.allocationUSDT)+' USDT')+
      td(x.riskBudgetUSDT==null?'—':num(x.riskBudgetUSDT)+' USDT')+
      td(x.error||'—')+'</tr>').join('')+
    '</table>':'<div class="empty">No real-money orders placed by this application.</div>';
  const events=Array.isArray(status.events)?status.events:[];
  $('liveEvents').innerHTML=events.length?
   '<table><tr><th>Time</th><th>Event</th><th>Details</th></tr>'+
   [...events].reverse().slice(0,40).map(x=>'<tr>'+td(new Date(x.time).toLocaleString())+
   td(x.event)+td(Object.entries(x).filter(v=>!['event','time'].includes(v[0]))
     .map(v=>v[0]+': '+String(v[1]).slice(0,100)).join(' · '))+'</tr>').join('')+
   '</table>':'<div class="empty">No real-account activity.</div>';
 }
 async function poll(){
  try{
    const r=await fetch('/api/binance-live/status',{cache:'no-store',signal:AbortSignal.timeout(8500)});
    if(!r.ok)throw Error('Real-account status unavailable (HTTP '+r.status+')');
    status=await r.json();
    update();
  }catch(e){msg='Local real account service unavailable';$('liveStatus').textContent=msg;}
 }
 async function act(action,data={}){
  if(busy)return;
  busy=true;update();
  try{
    const r=await fetch('/api/binance-live/'+action,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(30000)
    });
    const result=await r.json();
    if(!r.ok)throw Error(result.error||'Binance '+action+' request failed');
    msg=action==='arm'?'REAL automatic trading enabled — monitor your Binance account':
      action==='disarm'?'New real orders paused':action==='connect'?'Credentials encrypted on your Windows account':
      action==='verify'?'Real Binance Futures account verified':action==='settings'?'Real-money risk settings saved':
      'Saved Binance connection removed';
    if(action==='settings'){
      settingsDirty=false;
      $('liveRiskDraft').textContent='Saved. Values will remain until you change and save them again.';
    }
    await poll();
  }catch(e){
    msg=String(e.message).slice(0,210);
    if(action==='settings')$('liveRiskDraft').textContent='Not saved: '+msg;
  }
  finally{busy=false;update();}
 }
 $('liveRefreshAccount').addEventListener('click',()=>poll());
 $('liveConnect').addEventListener('click',async()=>{
  const apiKey=$('liveApiKey').value.trim(),apiSecret=$('liveApiSecret').value.trim();
  if(!apiKey||!apiSecret){msg='Enter both key and secret here on this laptop';update();return;}
  try{await act('connect',{apiKey,apiSecret})}
  finally{$('liveApiKey').value='';$('liveApiSecret').value='';}
 });
 $('liveVerify').addEventListener('click',()=>act('verify'));
 $('liveArm').addEventListener('click',async()=>{
  const phrase=$('liveArmPhrase').value.trim();
  if(phrase!=='ENABLE REAL BINANCE FUTURES AUTO TRADING'){
    msg='Type the exact confirmation phrase to activate REAL trading';update();return;
  }
  const confirmed=window.confirm('REAL MONEY WARNING: When active, each newly confirmed Binance Futures signal may place a REAL leveraged market order with exchange-side stop loss and take profit. Trading can lose actual money, including due to errors, slippage, outages or liquidation. Activate now?');
  if(!confirmed)return;
  $('liveArmPhrase').value='';
  await act('arm',{phrase});
 });
 $('liveDisarm').addEventListener('click',()=>act('disarm'));
 $('liveDisconnect').addEventListener('click',()=>{
  if(window.confirm('Remove locally encrypted Binance API credentials? Real trading will be paused. This will not automatically close any open Binance positions.'))
    act('disconnect');
 });
 for(const input of document.querySelectorAll('[data-live-setting]')){
   input.addEventListener('input',()=>{
     settingsDirty=true;
     $('liveRiskDraft').textContent='Unsaved changes — press Save trading preferences.';
   });
 }
 $('liveSaveRisk').addEventListener('click',()=>{
   const values={};
   for(const el of document.querySelectorAll('[data-live-setting]')){
     const raw=el.value.trim();
     const key=el.dataset.liveSetting;
     const whole=key==='maxLeverage'||key==='maxOrdersPerDay';
     if(!(whole?/^[0-9]+$/:/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(raw))){
       $('liveRiskDraft').textContent=whole?
         'Leverage and daily trades must be positive whole numbers.':
         'Margin allocation and risk percentage must be positive numbers.';
       el.focus();return;
     }
     const number=Number(raw);
     if(!Number.isFinite(number)||number<=0||
        whole&&!Number.isSafeInteger(number)){
       $('liveRiskDraft').textContent='Enter a valid positive value.';
       el.focus();return;
     }
     values[key]=number;
   }
   // The private service must validate and store all fields server-side,
   // especially maxDailyLossUSD. Never claim exchange enforcement from UI alone.
   act('settings',values);
 });
 poll();
 setInterval(()=>{if(!busy)poll()},12000);
})()
