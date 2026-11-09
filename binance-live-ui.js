'use strict';
// Real Binance account controls run ONLY in the Windows localhost dashboard.
// Never transmit Binance credentials to Render, GitHub or browser storage.
(function(){
 const panel=document.getElementById('realBinancePanel');
 if(!panel)return;
 const local=window.CRYPTO_LOCAL_SERVER===true;
 panel.hidden=!local;
 if(!local)return;
 const $=id=>document.getElementById(id);
 const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{
   minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 let status=null,busy=false,msg='';
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
    if(document.activeElement!==input&&status.config?.[input.dataset.liveSetting]!=null)
      input.value=status.config[input.dataset.liveSetting];
    input.disabled=busy||armed;
  }
  $('liveArm').disabled=busy||armed||!connected;
  $('liveDisarm').disabled=busy||!armed;
  $('liveConnect').disabled=busy||armed;
  $('liveVerify').disabled=busy||armed||!saved;
  $('liveDisconnect').disabled=busy||armed||!saved;
  $('liveSaveRisk').disabled=busy||armed;
  const orders=Array.isArray(status.orders)?status.orders:[];
  $('liveOrderCount').textContent=orders.length+' entries';
  const td=s=>'<td>'+h(s)+'</td>';
  $('liveOrders').innerHTML=orders.length?
    '<table><tr><th>Time</th><th>Coin</th><th>Side</th><th>Status</th><th>Real entry</th><th>Stop</th><th>Final TP</th><th>Issue</th></tr>'+
    [...orders].reverse().map(x=>'<tr>'+td(x.createdAt?new Date(x.createdAt).toLocaleString():'—')+
      td(x.sym)+td(x.dir)+td(x.status)+td(x.entry==null?'—':num(x.entry,6))+
      td(x.sl==null?'—':num(x.sl,6))+td(x.tp==null?'—':num(x.tp,6))+td(x.error||'—')+'</tr>').join('')+
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
    await poll();
  }catch(e){msg=String(e.message).slice(0,210);}
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
 $('liveSaveRisk').addEventListener('click',()=>{
  const values={};
  for(const el of document.querySelectorAll('[data-live-setting]')){
    if(!el.checkValidity()){el.reportValidity();return;}
    values[el.dataset.liveSetting]=Number(el.value);
  }
  act('settings',values);
 });
 poll();
 setInterval(()=>{if(!busy)poll()},12000);
})();