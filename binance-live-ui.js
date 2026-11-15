'use strict';
// Real Binance account controls run ONLY in the Windows localhost dashboard.
// Never transmit Binance credentials to Render, GitHub or browser storage.
(function(){
 const panel=document.getElementById('realBinancePanel');
 if(!panel)return;
 const local=window.CRYPTO_LOCAL_SERVER===true;
 panel.hidden=false;
 if(!local){
   // Public browser installations cannot access the Windows DPAPI vault and
   // MUST NOT transmit Binance credentials or order commands to Render.
   const $=id=>document.getElementById(id);
   const credentialPanel=$('liveCredentials');
   const status=$('liveStatus'),balance=$('liveBalance');
   const controls=document.querySelector('#realBinancePanel .paper-status[style*="background:#3d2631"]');
   credentialPanel.hidden=true;
   if(controls)controls.hidden=true;
   $('liveOrders').innerHTML='<div class="empty">No authenticated Binance connection in browser mode. Real orders and account positions are not available here. Review actual positions directly in Binance.</div>';
   $('liveEvents').innerHTML='<div class="empty">Browser risk-plan edits do not place trades or connect to Binance.</div>';
   $('liveOrderCount').textContent='Not connected';
   status.textContent='BINANCE LIVE SETUP — BROWSER DRAFT ONLY. No account linked, no live orders, no API credentials stored.';
   status.style.background='#233647';
   balance.innerHTML=[
     ['Account connection','Not connected'],
     ['Real USDT balance','Not available'],
     ['Order execution','Disabled'],
     ['Strategy','RSI(14) scalping + 1m AMD/FVG'],
     ['Risk plan','Editable local draft']
   ].map(([key,value])=>'<div><small>'+key+'</small><b>'+value+'</b></div>').join('');
   const title=$('liveRiskSettings').querySelector('summary');
   title.textContent='Binance Futures trade allocation and risk plan (browser draft)';
   const note=$('liveRiskSettings').querySelector('p.paper-note');
   note.textContent='This plan is stored in this browser only. It cannot retrieve your laptop’s settings or balance and cannot send real Binance orders. Confirm values yourself before any future separately authorized live integration.';
   const previousKey='crypto_signal_desk_browser_live_risk_draft_v1';
   let saved=null;try{saved=JSON.parse(localStorage.getItem(previousKey)||'null')}catch(_){}
   const allowed=['maxLeverage','tradeMarginUSDT','riskPerTradePct','maxOrdersPerDay'];
   const limits={maxLeverage:[1,125],tradeMarginUSDT:[1,100000],
     riskPerTradePct:[0.01,5],maxOrdersPerDay:[1,1000]};
   for(const el of document.querySelectorAll('[data-live-setting]')){
     const name=el.dataset.liveSetting;
     if(saved&&allowed.includes(name)&&Number.isFinite(saved[name]))
       el.value=String(saved[name]);
   }
   const message=$('liveRiskDraft');
   message.textContent='Draft only. The shown values are initial defaults unless you previously saved this browser’s plan. They are not verified account settings.';
   $('liveSaveRisk').textContent='Save browser risk plan (no real orders)';
   $('liveSaveRisk').addEventListener('click',()=>{
     const next={};
     for(const name of allowed){
       const el=document.querySelector('[data-live-setting="'+name+'"]');
       const value=Number(el.value),range=limits[name];
       if(!Number.isFinite(value)||value<range[0]||value>range[1]||
           (name==='maxLeverage'||name==='maxOrdersPerDay')&&!Number.isSafeInteger(value)){
         message.textContent='Not saved: '+name+' must be between '+range[0]+' and '+range[1]+
           ((name==='maxLeverage'||name==='maxOrdersPerDay')?' (whole number)':'')+'.';
         el.focus();return;
       }
       next[name]=value;
     }
     try{
       localStorage.setItem(previousKey,JSON.stringify(next));
       message.textContent='Browser risk-plan draft saved on this device. This does NOT enable Binance trading or update your laptop settings.';
     }catch(_){message.textContent='Could not save browser settings. Check storage permissions.'}
   });
   return;
 }
 const $=id=>document.getElementById(id);
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
  const b=status.balance;
  $('liveBalance').innerHTML=[
    ['Real account',connected?'Verified':'Not verified'],
    ['Available USDT',b?num(b.availableBalance):'—'],
    ['Futures wallet USDT',b?num(b.walletBalance):'—'],
    ['Real orders placed today',status.dailyOrders||0],
    ['Tracked real orders',status.orders?.length||0]
  ].map(x=>'<div><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');
  for(const input of document.querySelectorAll('[data-live-setting]')){
    // Polls occur every 12 seconds. Never overwrite a pending user edit,
    // even after the field loses focus.
    if(!settingsDirty&&document.activeElement!==input&&
       status.config?.[input.dataset.liveSetting]!=null)
      input.value=String(status.config[input.dataset.liveSetting]);
    input.disabled=busy||armed;
  }
  $('liveArm').disabled=true; // Simulation-only release: hard-disabled UI and backend.
  $('liveDisarm').disabled=busy||!armed;
  $('liveArmPhrase').disabled=true;
  $('liveConnect').disabled=true;
  $('liveVerify').disabled=true;
  $('liveDisconnect').disabled=busy||armed||!saved;
  $('liveSaveRisk').disabled=true;
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
   // Only the four visible preferences are sent; remaining mandatory
   // broker safety protections remain unchanged.
   act('settings',values);
 });
 poll();
 setInterval(()=>{if(!busy)poll()},12000);
})();