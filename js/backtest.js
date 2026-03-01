'use strict';

// ═══════════════════════════════════════════════
// BACKTEST ENGINE v3 — Full Live Trading Feel
// • Developing IB range (pulsing, expanding live)
// • TradingView-style bracket: Market/Limit, MNQ/NQ, Qty, TP, SL
// • Manual close at market
// • Real-time floating P&L in pts and dollars
// • Prop firm simulator with rule enforcement
// ═══════════════════════════════════════════════

// ─── Instrument tick/dollar values ──────────────
const TV_INSTRUMENTS={
  MNQ:{tickSize:0.25,tickValue:0.5,pointValue:2,label:'MNQ'},
  NQ: {tickSize:0.25,tickValue:5,  pointValue:20,label:'NQ'},
};

// ─── TV Order state ──────────────────────────────
let tvDir='long';
let tvOrderType='market'; // 'market'|'limit'
let tvInstr='MNQ';
let tvQty=1;
let tvBracket=null;
// tvBracket: {dir,entry,tp,sl,qty,instr,status,pnl,pnlUsd,entryTime,exitTime,exitReason,note}
// status: 'pending'|'active'|'tp_hit'|'sl_hit'|'manual'

// ─── Draw mode toggle ────────────────────────────
let btDrawMode=false; // false = pan mode, true = draw/place mode
function btToggleDrawMode(){
  btDrawMode=!btDrawMode;
  const btn=document.getElementById('bt-draw-toggle');
  if(btn){
    btn.textContent=btDrawMode?'✏ Draw':'🖐 Pan';
    btn.classList.toggle('active',btDrawMode);
  }
  const canvas=document.getElementById('btCanvas');
  if(canvas) canvas.style.cursor=btDrawMode?'crosshair':'grab';
}

// ─── Replay step size (raw 1m candles per tick) ──
let btReplayStep=1; // how many raw 1m candles to advance per tick
let btRawLimit=1;   // current position in raw 1m candle array
function setBtReplayStep(step){
  btReplayStep=Math.max(1,Math.round(step)||1);
  const el=document.getElementById('bt-replay-step');
  if(el) el.value=btReplayStep;
}

// ─── Journal tab state ───────────────────────────
let btCurrentJTab='trade';
function btSwitchJTab(tab){
  btCurrentJTab=tab;
  ['trade','log','prop'].forEach(t=>{
    document.getElementById('bjtab-'+t).classList.toggle('active',t===tab);
    document.getElementById('bjpanel-'+t).classList.toggle('bt-jpanel-hidden',t!==tab);
  });
}

// ─── Canvas setup ───────────────────────────────
function getBtCanvas(){
  const canvas=document.getElementById('btCanvas');
  const area=document.getElementById('bt-chart-area');
  const dpr=window.devicePixelRatio||1;
  const cssW=area.clientWidth,cssH=area.clientHeight;
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  return{canvas,ctx,W:cssW,H:cssH};
}

// ─── Load trade ───────────────────────────────────
async function btLoadTrade(trade){
  document.getElementById('bt-empty-state').style.display='none';
  document.getElementById('btCanvas').style.display='block';
  btTrade=trade;
  tvBracket=null;
  tvResetOrderUI();
  tvHideResult();
  btHideVerdict();
  // Reset to pan mode on every new session
  if(btDrawMode) btToggleDrawMode();

  const startTime=document.getElementById('bt-start-time').value.trim()||'10:15';
  const candles=await getCandlesForDate(trade.date);
  if(candles&&candles.length){
    const ibC=candles.filter(c=>c.time>='09:30'&&c.time<'10:30');
    if(ibC.length){
      trade._ib_high=Math.max(...ibC.map(c=>c.high));
      trade._ib_low=Math.min(...ibC.map(c=>c.low));
      trade._ib_mid=(trade._ib_high+trade._ib_low)/2;
    }
    btRawCandles=candles.filter(c=>c.time>='09:30');
  }else{
    const half=trade._ib_range_pts/2;
    trade._ib_high=trade.price_930+half;
    trade._ib_low=trade.price_930-half;
    trade._ib_mid=trade.price_930;
    btRawCandles=null;
  }
  btRebuildTF();
  // btRawLimit tracks position in raw 1m candles; btLimit derived from it
  if(btRawCandles){
    const startTime=document.getElementById('bt-start-time').value.trim()||'09:30';
    let idx=btRawCandles.findIndex(c=>c.time>=startTime);
    btRawLimit=Math.max(1,idx<0?1:idx);
    btLimit=btRawToDisplayLimit();
  }else{ btRawLimit=1; btLimit=1; }
  btPanOffset=0; btZoom=1;
  btUpdateTimeDisplay();
  btUpdateSessionInfo();
  btDraw();
  btInitCrosshair();
  btInitResize();
}

function btDrawEmpty(){
  document.getElementById('bt-empty-state').style.display='flex';
  document.getElementById('btCanvas').style.display='none';
}

function btRebuildTF(){
  // Build full-day aggregated candles (used for layout/axis sizing only)
  if(!btRawCandles){ btCandles=null; btVWAP=null; return; }
  btCandles=aggregateCandles(btRawCandles,btTF);
  btVWAP=computeVWAP(btCandles);
}

// ─── Developing candle toggle ────────────────────
let btDevCandleMode=true; // true = candle builds progressively; false = snap to completed bars only
function btToggleDevCandle(){
  btDevCandleMode=!btDevCandleMode;
  const btn=document.getElementById('bt-dev-candle-btn');
  if(btn){ btn.textContent=btDevCandleMode?'⟳ Dev':'□ Snap'; btn.classList.toggle('active',btDevCandleMode); }
  if(btTrade&&btCandles) btDraw();
}

// Build visible candles to the current replay position.
// Dev mode: aggregate only raw minutes seen so far → last candle builds in real time.
// Snap mode: show only fully completed aggregated candles.
function btGetLiveCandles(){
  if(!btRawCandles) return [];
  if(btDevCandleMode){
    const rawSoFar=btRawCandles.slice(0,Math.max(1,btRawLimit));
    return aggregateCandles(rawSoFar,btTF);
  } else {
    if(!btCandles) return [];
    return btCandles.slice(0,Math.max(1,btRawToDisplayLimit()));
  }
}

// Kept for compat — not really used for indexing anymore
function btRawToDisplayLimit(){
  if(!btRawCandles||!btCandles) return 1;
  const lastRawTime=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)].time;
  let di=0;
  for(let i=0;i<btCandles.length;i++){
    if(btCandles[i].time<=lastRawTime) di=i; else break;
  }
  return Math.max(1,di+1);
}

// ─── Developing IB ──────────────────────────────
function btComputeDevIB(vis){
  const ibc=vis.filter(c=>c.time>='09:30'&&c.time<'10:30');
  if(!ibc.length) return{h:null,l:null,mid:null,complete:false,range:0};
  const h=Math.max(...ibc.map(c=>c.high));
  const l=Math.min(...ibc.map(c=>c.low));
  return{h,l,mid:(h+l)/2,complete:vis.some(c=>c.time>='10:30'),range:h-l};
}

// ─── TF switcher (display only — replay advances raw 1m) ─
function setBtTF(tf,el){
  btTF=tf;
  document.querySelectorAll('[id^=bt-tf-]').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  if(btTrade){ btRebuildTF(); btLimit=btRawToDisplayLimit(); btDraw(); }
}

// ─── Playback ────────────────────────────────────
function btPlayPause(){
  const btn=document.getElementById('bt-play-btn');
  if(btTimer){
    clearInterval(btTimer); btTimer=null;
    btn.textContent='▶ Play'; btn.classList.remove('play');
  }else{
    const speed=+document.getElementById('bt-speed').value||400;
    btTimer=setInterval(()=>{
      if(!btRawCandles||btRawLimit>=btRawCandles.length){ btStopTimer(); return; }
      // Advance by btReplayStep raw 1m candles
      btRawLimit=Math.min(btRawCandles.length,btRawLimit+btReplayStep);
      btLimit=btRawToDisplayLimit();
      tvTickBracket();
      btUpdateTimeDisplay();
      btUpdateSessionInfo();
      btDraw();
    },speed);
    btn.textContent='⏸ Pause'; btn.classList.add('play');
  }
}
function btStopTimer(){
  if(btTimer){ clearInterval(btTimer); btTimer=null; }
  const btn=document.getElementById('bt-play-btn');
  if(btn){ btn.textContent='▶ Play'; btn.classList.remove('play'); }
}
function btStep(dir){
  if(!btRawCandles) return;
  btStopTimer();
  btRawLimit=Math.max(1,Math.min(btRawCandles.length,btRawLimit+dir*btReplayStep));
  btLimit=btRawToDisplayLimit();
  tvTickBracket();
  btUpdateTimeDisplay(); btUpdateSessionInfo(); btDraw();
}
function btReset(){
  btStopTimer();
  tvBracket=null;
  tvResetOrderUI();
  tvHideResult();
  btHideVerdict();
  const startTime=document.getElementById('bt-start-time').value.trim()||'09:30';
  if(btRawCandles){
    let idx=btRawCandles.findIndex(c=>c.time>=startTime);
    btRawLimit=Math.max(1,idx<0?1:idx);
    btLimit=btRawToDisplayLimit();
  }else{ btRawLimit=1; btLimit=1; }
  btPanOffset=0; btZoom=1;
  btUpdateTimeDisplay(); btUpdateSessionInfo(); btDraw();
}
function btUpdateTimeDisplay(){
  // Show raw 1m time so user always sees exact minute even on aggregated TF
  if(!btRawCandles||!btRawCandles.length){ document.getElementById('bt-time').textContent='—'; return; }
  const cur=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
  document.getElementById('bt-time').textContent=cur?cur.time:'—';
  document.getElementById('bt-session-cnt').textContent=`${btRawLimit} / ${btRawCandles.length}`;
}
function btUpdateSessionInfo(){
  if(!document.getElementById('bt-session-date')) return;
  document.getElementById('bt-session-date').textContent=btTrade?btTrade.date:'—';
  if(btRawCandles&&btTrade){
    const vis=btGetLiveCandles();
    const dev=btComputeDevIB(vis);
    const el=document.getElementById('bt-session-ibr');
    if(dev.complete){ el.textContent=(dev.h-dev.l).toFixed(2)+' pts'; el.style.color='var(--gold)'; }
    else if(dev.h){ el.textContent='~'+(dev.h-dev.l).toFixed(2)+' pts (forming)'; el.style.color='var(--text-mid)'; }
    else { el.textContent='—'; el.style.color='var(--text-dim)'; }
  }
  document.getElementById('bt-session-cnt').textContent=btRawCandles?`${btRawLimit} / ${btRawCandles.length} raw`:'—';
}

// ═══════════════════════════════════════════════
// TV ORDER SYSTEM
// ═══════════════════════════════════════════════

function tvSetDir(dir,el){
  tvDir=dir;
  document.getElementById('tv-dir-long').classList.toggle('active',dir==='long');
  document.getElementById('tv-dir-short').classList.toggle('active',dir==='short');
  // Update exec button label
  tvUpdateExecLabel();
  // Auto-fill from current dev IB
  tvAutoFill();
}

function tvSetType(type,el){
  tvOrderType=type;
  document.getElementById('tv-type-market').classList.toggle('active',type==='market');
  document.getElementById('tv-type-limit').classList.toggle('active',type==='limit');
  const limitRow=document.getElementById('tv-limit-row');
  if(limitRow) limitRow.style.display=type==='limit'?'flex':'none';
  tvUpdateExecLabel();
}

function tvSetInstr(instr,el){
  tvInstr=instr;
  document.getElementById('tv-instr-mnq').classList.toggle('active',instr==='MNQ');
  document.getElementById('tv-instr-nq').classList.toggle('active',instr==='NQ');
  tvUpdateCalc();
}

function tvAdjQty(delta){
  tvQty=Math.max(1,tvQty+delta);
  const el=document.getElementById('tv-qty');
  if(el) el.textContent=tvQty;
  tvUpdateCalc();
}

function tvUpdateExecLabel(){
  const el=document.getElementById('tv-exec-label');
  if(!el) return;
  const dLabel=tvDir==='long'?'Long':'Short';
  const tLabel=tvOrderType==='market'?'Market':'Limit';
  el.textContent=`Execute ${dLabel} ${tLabel}`;
  const btn=document.getElementById('tv-exec-btn');
  if(btn){
    btn.className=`tv-exec-btn ${tvDir}`;
  }
}

function tvAutoFill(){
  if(!btCandles) return;
  const vis=btCandles.slice(0,Math.max(1,btLimit));
  const dev=btComputeDevIB(vis);
  if(!dev.h) return;
  const ibR=dev.range;
  const tpEl=document.getElementById('tv-tp-px');
  const slEl=document.getElementById('tv-sl-px');
  const limEl=document.getElementById('tv-limit-px');
  if(tvDir==='long'){
    if(tpEl&&!tpEl.value) tpEl.value=(dev.h+ibR).toFixed(2);
    if(slEl&&!slEl.value) slEl.value=(dev.h-ibR*0.5).toFixed(2);
    if(limEl&&!limEl.value) limEl.value=dev.h.toFixed(2);
  }else{
    if(tpEl&&!tpEl.value) tpEl.value=(dev.l-ibR).toFixed(2);
    if(slEl&&!slEl.value) slEl.value=(dev.l+ibR*0.5).toFixed(2);
    if(limEl&&!limEl.value) limEl.value=dev.l.toFixed(2);
  }
  tvUpdateCalc();
}

function tvUpdateCalc(){
  const tp=parseFloat(document.getElementById('tv-tp-px')?.value)||null;
  const sl=parseFloat(document.getElementById('tv-sl-px')?.value)||null;
  // Use current price as reference for market, limit price for limit
  let refPrice=null;
  if(tvOrderType==='limit'){
    refPrice=parseFloat(document.getElementById('tv-limit-px')?.value)||null;
  }else if(btRawCandles&&btRawLimit){
    const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
    refPrice=c?c.close:null;
  }
  const pv=TV_INSTRUMENTS[tvInstr].pointValue*tvQty;

  const tpEl=document.getElementById('tv-tp-pts');
  const slEl=document.getElementById('tv-sl-pts');
  const rrEl=document.getElementById('tv-rr-label');
  const riskEl=document.getElementById('tv-risk-label');

  if(refPrice&&tp){
    const tpPts=tvDir==='long'?(tp-refPrice):(refPrice-tp);
    if(tpEl) tpEl.textContent=`+${tpPts.toFixed(1)}pts / +$${(tpPts*pv).toFixed(0)}`;
  }else if(tpEl) tpEl.textContent='';

  if(refPrice&&sl){
    const slPts=tvDir==='long'?(refPrice-sl):(sl-refPrice);
    if(slEl) slEl.textContent=`-${slPts.toFixed(1)}pts / -$${(slPts*pv).toFixed(0)}`;
  }else if(slEl) slEl.textContent='';

  if(refPrice&&tp&&sl&&sl!==refPrice){
    const reward=Math.abs(tp-refPrice);
    const risk=Math.abs(sl-refPrice);
    const rr=(reward/risk).toFixed(2);
    if(rrEl){ rrEl.textContent=`R/R ${rr}×`; rrEl.style.color=parseFloat(rr)>=1?'var(--green)':'var(--red)'; }
    if(riskEl){ const riskUsd=(risk*pv).toFixed(0); riskEl.textContent=`Risk $${riskUsd}`; riskEl.style.color='var(--red)'; }
  }else{
    if(rrEl){ rrEl.textContent='—'; rrEl.style.color='var(--text-dim)'; }
    if(riskEl){ riskEl.textContent='—'; riskEl.style.color='var(--text-dim)'; }
  }
  tvUpdateExecLabel();
  // Redraw chart so draft lines update live as you type
  if(btTrade&&btCandles) btDraw();
}

function tvPlaceOrder(){
  if(!btTrade||!btCandles) return;
  const tp=parseFloat(document.getElementById('tv-tp-px')?.value)||null;
  const sl=parseFloat(document.getElementById('tv-sl-px')?.value)||null;
  const note=document.getElementById('tv-note')?.value||'';

  let entry, status;
  if(tvOrderType==='market'){
    const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
    entry=c.close;
    status='active';
  }else{
    const lim=parseFloat(document.getElementById('tv-limit-px')?.value);
    if(isNaN(lim)){ alert('Enter a limit price'); return; }
    entry=lim;
    status='pending';
  }

  if(!sl){ alert('Stop loss is required'); return; }

  tvBracket={dir:tvDir,entry,tp,sl,qty:tvQty,instr:tvInstr,
    status,pnl:null,pnlUsd:null,entryTime:null,exitTime:null,exitReason:null,note};

  if(status==='active'){
    tvBracket.entryTime=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)].time;
    tvShowLiveCard();
  }else{
    tvShowPendingCard();
  }
  tvTickBracket();
  btDraw();
}

function tvShowLiveCard(){
  document.getElementById('tv-order-card').classList.add('hidden');
  document.getElementById('tv-live-card').classList.remove('hidden');
  document.getElementById('tv-result-card').classList.add('hidden');
  const b=tvBracket;
  const dLabel=b.dir==='long'?'▲ LONG':'▼ SHORT';
  document.getElementById('tv-live-dir-label').textContent=`${b.qty}× ${b.instr} ${dLabel}`;
  document.getElementById('tv-live-dir-label').style.color=b.dir==='long'?'var(--green)':'var(--red)';
  document.getElementById('tv-live-entry').textContent=b.entry.toFixed(2);
  document.getElementById('tv-live-tp').textContent=b.tp?b.tp.toFixed(2):'—';
  document.getElementById('tv-live-sl').textContent=b.sl?b.sl.toFixed(2):'—';
  document.getElementById('tv-live-status').textContent=b.status==='pending'?'⏳ PENDING':'⚡ ACTIVE';
}

function tvShowPendingCard(){
  tvShowLiveCard();
  document.getElementById('tv-live-status').textContent='⏳ PENDING';
}

function tvHideResult(){
  const el=document.getElementById('tv-result-card');
  if(el) el.classList.add('hidden');
  const oc=document.getElementById('tv-order-card');
  if(oc) oc.classList.remove('hidden');
  const lc=document.getElementById('tv-live-card');
  if(lc) lc.classList.add('hidden');
}

// ─── Tick: check bracket on each candle ──────────
function tvTickBracket(){
  if(!tvBracket||!btRawCandles) return;
  // Use raw 1m candles for price checking — most accurate TP/SL detection
  const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
  if(!c) return;
  const b=tvBracket;

  if(b.status==='pending'){
    const hit=b.dir==='long'?(c.low<=b.entry):(c.high>=b.entry);
    if(hit){
      b.status='active'; b.entryTime=c.time;
      const statusEl=document.getElementById('tv-live-status');
      if(statusEl) statusEl.textContent='⚡ ACTIVE';
    }
  }

  if(b.status==='active'){
    const pv=TV_INSTRUMENTS[b.instr].pointValue*b.qty;
    const tpHit=b.tp!=null&&(b.dir==='long'?c.high>=b.tp:c.low<=b.tp);
    const slHit=b.sl!=null&&(b.dir==='long'?c.low<=b.sl:c.high>=b.sl);

    if(tpHit&&slHit){
      tvFinalize('sl_hit',c.time);
    }else if(tpHit){
      tvFinalize('tp_hit',c.time);
    }else if(slHit){
      tvFinalize('sl_hit',c.time);
    }else{
      const pts=b.dir==='long'?(c.close-b.entry):(b.entry-c.close);
      b.pnl=pts; b.pnlUsd=pts*pv;
      tvUpdateFloatingPnL(pts,b.pnlUsd,c.close);
    }
  }
}

function tvUpdateFloatingPnL(pts,usd,currentPx){
  const pnlEl=document.getElementById('bt-live-pnl');
  const usdEl=document.getElementById('tv-live-pnl-usd');
  const curEl=document.getElementById('tv-live-current');
  if(pnlEl){ pnlEl.textContent=(pts>=0?'+':'')+pts.toFixed(2)+' pts'; pnlEl.style.color=pts>=0?'var(--green)':'var(--red)'; }
  if(usdEl){ usdEl.textContent=(usd>=0?'+$':'-$')+Math.abs(usd).toFixed(0); usdEl.style.color=usd>=0?'var(--green)':'var(--red)'; }
  if(curEl&&currentPx) curEl.textContent=currentPx.toFixed(2);
}

function tvManualClose(){
  if(!tvBracket||tvBracket.status!=='active') return;
  btStopTimer();
  const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
  tvFinalize('manual',c.time);
}

function tvFinalize(reason,exitTime){
  const b=tvBracket;
  if(!b) return;
  b.status=reason; b.exitTime=exitTime; b.exitReason=reason;
  const pv=TV_INSTRUMENTS[b.instr].pointValue*b.qty;
  let pts,exitPx;
  if(reason==='tp_hit'){ exitPx=b.tp; pts=b.dir==='long'?(b.tp-b.entry):(b.entry-b.tp); }
  else if(reason==='sl_hit'){ exitPx=b.sl; pts=b.dir==='long'?(b.sl-b.entry):(b.entry-b.sl); }
  else{
    // manual close at current
    const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
    exitPx=c.close; pts=b.dir==='long'?(c.close-b.entry):(b.entry-c.close);
  }
  b.pnl=pts; b.pnlUsd=pts*pv;

  if(reason!=='manual') btStopTimer();

  // Show result card
  tvShowResultCard(reason,pts,b.pnlUsd);

  // Record to journal
  const t=btTrade;
  const actual=t.first_break;
  const correct=(b.dir==='long'&&actual==='High')||(b.dir==='short'&&actual==='Low');
  btJournal.unshift({
    date:t.date,dir:b.dir,entry:b.entry,tp:b.tp,sl:b.sl,qty:b.qty,instr:b.instr,
    note:b.note,entryTime:b.entryTime||'—',exitTime,
    pnl:pts,pnlUsd:b.pnlUsd,outcome:reason,correct,
    actual,ibHigh:t._ib_high,ibLow:t._ib_low,ibRange:t._ib_range_pts,isWinner:t.is_winner,
  });
  btRenderJournal(); btUpdateSummary();

  // Prop sim: register this trade's result
  if(propActive) propRegisterTrade(b.pnlUsd,t.date);

  btDraw();
}

function tvShowResultCard(reason,pts,usd){
  document.getElementById('tv-order-card').classList.add('hidden');
  document.getElementById('tv-live-card').classList.add('hidden');
  const rc=document.getElementById('tv-result-card');
  rc.classList.remove('hidden');
  const icons={tp_hit:'🎯',sl_hit:'🔴',manual:'✋'};
  const labels={tp_hit:'TARGET HIT',sl_hit:'STOPPED OUT',manual:'MANUALLY CLOSED'};
  document.getElementById('tv-result-icon').textContent=icons[reason]||'—';
  const rl=document.getElementById('tv-result-label');
  rl.textContent=labels[reason]||reason;
  rl.className='tv-result-label '+(pts>=0?'win':'loss');
  const pnlEl=document.getElementById('tv-result-pnl');
  pnlEl.textContent=(pts>=0?'+':'')+pts.toFixed(2)+' pts';
  pnlEl.style.color=pts>=0?'var(--green)':'var(--red)';
  const usdEl=document.getElementById('tv-result-usd');
  usdEl.textContent=(usd>=0?'+$':'-$')+Math.abs(usd).toFixed(0);
  usdEl.style.color=usd>=0?'var(--green)':'var(--red)';

  // Verdict in topbar
  const vd=document.getElementById('bt-verdict');
  if(vd){
    vd.textContent=pts>=0?`🎯 +${pts.toFixed(1)}pts  +$${Math.abs(usd).toFixed(0)}`:`🔴 ${pts.toFixed(1)}pts  -$${Math.abs(usd).toFixed(0)}`;
    vd.className='bt-verdict '+(pts>=0?'win':'loss');
  }
}

function tvNextTrade(){
  tvBracket=null;
  tvResetOrderUI();
  tvHideResult();
  btHideVerdict();
  // In prop mode, advance to next session
  if(propActive){ propAdvanceDay(); return; }
  // Otherwise just reset replay
  btReset();
}

function tvResetOrderUI(){
  // Show order card, hide live/result
  const oc=document.getElementById('tv-order-card');
  const lc=document.getElementById('tv-live-card');
  const rc=document.getElementById('tv-result-card');
  if(oc) oc.classList.remove('hidden');
  if(lc) lc.classList.add('hidden');
  if(rc) rc.classList.add('hidden');
  // Clear inputs
  ['tv-tp-px','tv-sl-px','tv-limit-px','tv-note'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  // Clear calc hints
  ['tv-tp-pts','tv-sl-pts'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent=''; });
  const rrEl=document.getElementById('tv-rr-label'); if(rrEl){ rrEl.textContent='—'; rrEl.style.color='var(--text-dim)'; }
  const riskEl=document.getElementById('tv-risk-label'); if(riskEl){ riskEl.textContent='—'; riskEl.style.color='var(--text-dim)'; }
  const pnlEl=document.getElementById('bt-live-pnl'); if(pnlEl){ pnlEl.textContent='—'; pnlEl.style.color='var(--text-dim)'; }
  const usdEl=document.getElementById('tv-live-pnl-usd'); if(usdEl){ usdEl.textContent='—'; usdEl.style.color='var(--text-dim)'; }
  tvUpdateExecLabel();
}

// ─── Compat stubs (old IDs still referenced) ─────
function btSetDir(){}
function btPlaceOrder(){ tvPlaceOrder(); }
function btSubmitDecision(){ tvPlaceOrder(); }
function btUpdateRR(){ tvUpdateCalc(); }
function btHideVerdict(){ const v=document.getElementById('bt-verdict'); if(v) v.className='bt-verdict hidden'; }
function btUpdateLivePnL(pts){ const el=document.getElementById('bt-live-pnl'); if(!el) return; if(pts===null){el.textContent='—';el.style.color='var(--text-dim)';return;} el.textContent=(pts>=0?'+':'')+pts.toFixed(2)+' pts'; el.style.color=pts>=0?'var(--green)':'var(--red)'; }

// ═══════════════════════════════════════════════
// PROP FIRM SIMULATOR
// ═══════════════════════════════════════════════
let propActive=false;
let propRules=null;
let propState=null; // {balance,startBalance,profitTarget,maxDailyLoss,maxDrawdown,minDays,
                    //  consistency,instrument,monthTrades,dayIdx,dailyPnL,peakBalance,
                    //  tradedDays,failed,passed,failReason}

function propStartSim(){
  const balance=parseFloat(document.getElementById('prop-balance').value)||50000;
  const target=parseFloat(document.getElementById('prop-target').value)||3000;
  const dailyLoss=parseFloat(document.getElementById('prop-daily-loss').value)||1500;
  const maxDD=parseFloat(document.getElementById('prop-max-dd').value)||2500;
  const minDays=parseInt(document.getElementById('prop-min-days').value)||5;
  const instr=document.getElementById('prop-instr').value||'MNQ';
  const consistency=document.getElementById('prop-consistency').value||'none';
  if(!allTrades||!allTrades.length){ alert('Load trades first'); return; }
  const months=[...new Set(allTrades.map(t=>t.date.slice(0,7)))].sort();
  const startMonth=months[Math.floor(Math.random()*months.length)];
  const tradesToUse=[...allTrades].filter(t=>t.date>=startMonth).sort((a,b)=>a.date.localeCompare(b.date));
  if(!tradesToUse.length){ alert('No trades available from that period'); return; }
  propRules={balance,target,dailyLoss,maxDD,minDays,instr,consistency,startMonth};
  propState={balance,startBalance:balance,tradesToUse,dayIdx:0,dailyPnL:0,peakBalance:balance,tradedDays:0,failed:false,passed:false,failReason:null,totalPnlUsd:0};
  propActive=true;
  tvInstr=instr;
  document.getElementById('tv-instr-mnq').classList.toggle('active',instr==='MNQ');
  document.getElementById('tv-instr-nq').classList.toggle('active',instr==='NQ');
  btSwitchJTab('trade');
  propUpdateHUD();
  document.getElementById('prop-setup').classList.add('hidden');
  document.getElementById('prop-hud').classList.remove('hidden');
  propLoadDaySession(0);
}

function propLoadDaySession(idx){
  if(!propState) return;
  const{tradesToUse}=propState;
  if(idx>=tradesToUse.length){
    const profit=propState.balance-propState.startBalance;
    const pass=profit>=propRules.target&&propState.tradedDays>=propRules.minDays;
    propEndSim(pass,pass?'Target reached':'Ran out of trade data'); return;
  }
  propState.dayIdx=idx;
  propState.dailyPnL=0;
  const trade=tradesToUse[idx];
  // Always reset to pan mode on new day
  if(btDrawMode) btToggleDrawMode();
  selectTrade(trade,allTrades.indexOf(trade));
  if(currentView!=='backtest') switchView('backtest');
  propUpdateHUD();
}

// Called from tvNextTrade after closing a position — counts as a traded day
function propAdvanceDay(){
  if(!propState||propState.failed||propState.passed) return;
  propState.tradedDays++;
  const profit=propState.balance-propState.startBalance;
  if(profit>=propRules.target&&propState.tradedDays>=propRules.minDays){
    propEndSim(true,'Profit target reached'); return;
  }
  propLoadDaySession(propState.dayIdx+1);
}

// Skip this day without trading it (doesn't count toward min days)
function propSkipDay(){
  if(!propState||propState.failed||propState.passed) return;
  tvBracket=null; tvResetOrderUI(); tvHideResult(); btHideVerdict();
  propLoadDaySession(propState.dayIdx+1);
}

function propRegisterTrade(pnlUsd){
  if(!propState||propState.failed||propState.passed) return;
  propState.balance+=pnlUsd;
  propState.dailyPnL+=pnlUsd;
  propState.totalPnlUsd+=pnlUsd;
  if(propState.balance>propState.peakBalance) propState.peakBalance=propState.balance;
  if(propState.dailyPnL<=-propRules.dailyLoss){ propEndSim(false,`Daily loss limit hit ($${propRules.dailyLoss})`); return; }
  const dd=propState.peakBalance-propState.balance;
  if(dd>=propRules.maxDD){ propEndSim(false,`Max drawdown hit ($${propRules.maxDD})`); return; }
  if(propState.balance<=propState.startBalance-propRules.maxDD){ propEndSim(false,'Account blown'); return; }
  propUpdateHUD();
}

function propEndSim(passed,reason){
  propState.passed=passed; propState.failed=!passed; propState.failReason=passed?null:reason;
  propActive=false;
  propUpdateHUD();
  const vd=document.getElementById('bt-verdict');
  if(vd){ vd.textContent=passed?'🏆 PROP PASSED':'💀 PROP FAILED: '+reason; vd.className='bt-verdict '+(passed?'win':'loss'); }
  ['prop-skip-btn','prop-skip-btn-order'].forEach(id=>{ const sb=document.getElementById(id); if(sb) sb.style.display='none'; });
}

function propResetSim(){
  propActive=false; propRules=null; propState=null;
  document.getElementById('prop-setup').classList.remove('hidden');
  document.getElementById('prop-hud').classList.add('hidden');
  btHideVerdict();
}

function propUpdateHUD(){
  if(!propState||!propRules) return;
  const{balance,startBalance,dailyPnL,peakBalance,tradedDays,tradesToUse,dayIdx,failed,passed,failReason}=propState;
  const{target,dailyLoss,maxDD,minDays,startMonth}=propRules;
  const profit=balance-startBalance;
  const dd=peakBalance-balance;
  const currentTrade=tradesToUse&&tradesToUse[dayIdx];
  const currentMonth=currentTrade?currentTrade.date.slice(0,7):startMonth;

  document.getElementById('prop-hud-month').textContent=currentMonth;
  const badge=document.getElementById('prop-hud-badge');
  if(passed){ badge.textContent='✓ PASSED'; badge.style.background='var(--green-dim)'; badge.style.color='var(--green)'; }
  else if(failed){ badge.textContent='✗ FAILED'; badge.style.background='var(--red-dim)'; badge.style.color='var(--red)'; }
  else { badge.textContent='ACTIVE'; badge.style.background='var(--gold-dim)'; badge.style.color='var(--gold)'; }

  const acctPct=Math.min(100,Math.max(0,(profit/target)*100));
  const af=document.getElementById('prop-acct-fill');
  if(af){ af.style.width=acctPct+'%'; af.style.background=profit>=0?'var(--green)':'var(--red)'; }
  document.getElementById('prop-acct-val').textContent='$'+balance.toFixed(0);
  document.getElementById('prop-acct-val').style.color=profit>=0?'var(--text)':'var(--red)';

  const pf=document.getElementById('prop-profit-fill');
  if(pf) pf.style.width=Math.min(100,Math.max(0,(profit/target)*100))+'%';
  const ppv=document.getElementById('prop-profit-val');
  ppv.textContent=(profit>=0?'+$':'-$')+Math.abs(profit).toFixed(0)+' / $'+target;
  ppv.style.color=profit>=0?'var(--green)':'var(--red)';

  const todayPct=Math.min(100,Math.max(0,Math.abs(dailyPnL/dailyLoss)*100));
  const tf=document.getElementById('prop-today-fill');
  if(tf){ tf.style.width=todayPct+'%'; tf.style.background=dailyPnL>=0?'var(--green)':'var(--red)'; }
  const tv2=document.getElementById('prop-today-val');
  tv2.textContent=(dailyPnL>=0?'+$':'-$')+Math.abs(dailyPnL).toFixed(0)+' / $'+dailyLoss+' limit';
  tv2.style.color=dailyPnL<-dailyLoss*0.7?'var(--red)':'var(--text-mid)';

  const rules=[
    {label:'Profit Target',ok:profit>=target,val:'$'+profit.toFixed(0)+' / $'+target},
    {label:'Daily Loss',ok:dailyPnL>-dailyLoss,val:'$'+Math.abs(dailyPnL).toFixed(0)+' / $'+dailyLoss},
    {label:'Max Drawdown',ok:dd<maxDD,val:'$'+dd.toFixed(0)+' / $'+maxDD},
    {label:'Min Days',ok:tradedDays>=minDays,val:tradedDays+' / '+minDays+' days'},
  ];
  const rl=document.getElementById('prop-rules-list');
  if(rl) rl.innerHTML=rules.map(r=>`<div class="prop-rule-row"><span class="prop-rule-dot ${r.ok?'ok':'pending'}"></span><span class="prop-rule-label">${r.label}</span><span class="prop-rule-val">${r.val}</span></div>`).join('')+(failReason?`<div style="color:var(--red);font-size:10px;padding:6px 0;font-weight:600">✗ ${failReason}</div>`:'');

  document.getElementById('prop-day-num').textContent=`Day ${dayIdx+1}  (${tradedDays} traded)`;
  document.getElementById('prop-days-left').textContent=currentTrade?currentTrade.date:'—';

  const showSkip=propActive&&!failed&&!passed;
  ['prop-skip-btn','prop-skip-btn-order'].forEach(id=>{
    const sb=document.getElementById(id); if(sb) sb.style.display=showSkip?'block':'none';
  });
}

// ═══════════════════════════════════════════════
// JOURNAL
// ═══════════════════════════════════════════════
function btRenderJournal(){
  const log=document.getElementById('bt-log');
  const empty=document.getElementById('bt-log-empty');
  if(!btJournal.length){ if(empty) empty.style.display='flex'; return; }
  if(empty) empty.style.display='none';
  const badge=document.getElementById('bt-log-badge');
  if(badge) badge.textContent=btJournal.length;

  log.innerHTML=btJournal.map((r,i)=>{
    const outcome=r.outcome||'skip';
    const rText={tp_hit:'TP',sl_hit:'SL',manual:'MAN',skip:'SKIP'}[outcome]||'—';
    const rCls={tp_hit:'correct',sl_hit:'wrong',manual:'skip',skip:'skip'}[outcome]||'';
    const dirChip=r.dir==='long'?'long':r.dir==='short'?'short':'skip';
    const dirLabel=r.dir==='long'?'↑ L':r.dir==='short'?'↓ S':'—';
    const pnlPts=r.pnl!=null?((r.pnl>=0?'+':'')+r.pnl.toFixed(1)):'—';
    const pnlUsd=r.pnlUsd!=null?((r.pnlUsd>=0?'+$':'-$')+Math.abs(r.pnlUsd).toFixed(0)):'';
    const pnlColor=r.pnl==null?'var(--text-dim)':r.pnl>=0?'var(--green)':'var(--red)';
    return `<div class="bt-log-entry${btSelectedEntry===i?' selected':''}" onclick="btSelectEntry(${i})">
      <div class="bt-entry-header">
        <span class="bt-entry-date">${r.date} <span style="color:var(--text-dim);font-size:9px">@${r.entryTime||r.time||'—'}</span></span>
        <span class="bt-entry-result ${rCls}">${rText}</span>
      </div>
      <div class="bt-entry-meta">
        <span class="bt-entry-chip ${dirChip}">${dirLabel}</span>
        ${r.instr?`<span style="font-size:9px;color:var(--text-dim)">${r.qty||1}×${r.instr}</span>`:''}
        ${r.entry!=null?`<span style="font-size:10px;color:var(--text-mid)">@${r.entry.toFixed(2)}</span>`:''}
        <span class="bt-entry-pnl" style="color:${pnlColor};margin-left:auto">${pnlPts} ${pnlUsd}</span>
      </div>
      ${r.note?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px;font-style:italic">${r.note}</div>`:''}
    </div>`;
  }).join('');
}

function btSelectEntry(i){ btSelectedEntry=i; btRenderJournal(); }

function btUpdateSummary(){
  const nonSkip=btJournal.filter(r=>r.dir!=='skip');
  const tpHits=btJournal.filter(r=>r.outcome==='tp_hit').length;
  const pnls=btJournal.filter(r=>r.pnl!=null).map(r=>r.pnl);
  const totalPnl=pnls.length?pnls.reduce((a,b)=>a+b,0):0;
  const acc=nonSkip.length?((tpHits/nonSkip.length)*100).toFixed(0)+'%':'—';
  document.getElementById('bt-sum-total').textContent=btJournal.length;
  document.getElementById('bt-sum-correct').textContent=tpHits;
  document.getElementById('bt-sum-acc').textContent=acc;
  const pe=document.getElementById('bt-sum-pnl');
  pe.textContent=(totalPnl>=0?'+':'')+totalPnl.toFixed(1);
  pe.style.color=totalPnl>=0?'var(--green)':'var(--red)';
}

function btClearSession(){
  if(!btJournal.length||confirm('Clear all journal entries?')){
    btJournal=[];btSelectedEntry=null;
    btRenderJournal();btUpdateSummary();
    const badge=document.getElementById('bt-log-badge');
    if(badge) badge.textContent='';
  }
}

function btExportCSV(){
  if(!btJournal.length) return;
  const header='date,entryTime,exitTime,direction,instr,qty,entry,tp,sl,pnl_pts,pnl_usd,outcome,note';
  const rows=btJournal.map(r=>
    [r.date,r.entryTime||'',r.exitTime||'',r.dir||'',r.instr||'',r.qty||1,
     r.entry||'',r.tp||'',r.sl||'',
     r.pnl!=null?r.pnl.toFixed(2):'',r.pnlUsd!=null?r.pnlUsd.toFixed(2):'',
     r.outcome||'','"'+(r.note||'').replace(/"/g,'""')+'"'].join(','));
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent([header,...rows].join('\n'));
  a.download='ib_backtest.csv'; a.click();
}

// ═══════════════════════════════════════════════
// CHART DRAW
// ═══════════════════════════════════════════════
let btPanOffset=0,btZoom=1;

function btDraw(){
  if(!btTrade||!btCandles) return;
  const{ctx,W,H}=getBtCanvas();
  ctx.fillStyle='#070b10'; ctx.fillRect(0,0,W,H);

  // allC = full day layout reference (for x-axis spacing)
  const allC=btCandles;
  // candles = LIVE progressive view — last candle builds as raw minutes arrive
  const candles=btGetLiveCandles();
  // vwap computed from live candles too
  const liveVwap=computeVWAP(candles);
  const vwap=liveVwap;
  const n=candles.length;
  const ml=8,mr=84,mt=24,volH=40,mb=28+volH,chartH=H-mt-mb,chartW=W-ml-mr;
  const cw=Math.max(3,chartW/allC.length*btZoom);
  function px(i){ return ml+i*cw+cw*0.5+btPanOffset; }

  const dev=btComputeDevIB(candles);

  // Price range
  let minP=Infinity,maxP=-Infinity;
  candles.forEach(c=>{ minP=Math.min(minP,c.low); maxP=Math.max(maxP,c.high); });
  if(tvBracket){
    [tvBracket.entry,tvBracket.tp,tvBracket.sl].forEach(v=>{ if(v!=null){ minP=Math.min(minP,v); maxP=Math.max(maxP,v); }});
  }
  // Include draft input values too
  const dTP=parseFloat(document.getElementById('tv-tp-px')?.value)||null;
  const dSL=parseFloat(document.getElementById('tv-sl-px')?.value)||null;
  const dLim=parseFloat(document.getElementById('tv-limit-px')?.value)||null;
  [dTP,dSL,dLim].forEach(v=>{ if(v!=null){ minP=Math.min(minP,v); maxP=Math.max(maxP,v); }});
  if(dev.h){ minP=Math.min(minP,dev.l-2); maxP=Math.max(maxP,dev.h+2); }
  const pad=(maxP-minP)*0.08,pMin=minP-pad,pMax=maxP+pad;
  function py(p){ return mt+chartH-((p-pMin)/(pMax-pMin))*chartH; }
  const maxVol=Math.max(...candles.map(c=>c.volume),1),volY=mt+chartH+4;

  // ── Cache metrics for mouse handlers ──
  _btChartMetrics={ml,mr,mt,chartH,pMin,pMax,py};

  // IB zone bg
  const ibCnt=candles.filter(c=>c.time<'10:30').length;
  if(ibCnt>0){
    const x0=px(0)-cw*0.5,x1=px(Math.min(ibCnt-1,n-1))+cw*0.5;
    const g=ctx.createLinearGradient(x0,0,x1,0);
    g.addColorStop(0,'rgba(240,180,41,0)');g.addColorStop(.12,'rgba(240,180,41,0.035)');
    g.addColorStop(.88,'rgba(240,180,41,0.035)');g.addColorStop(1,'rgba(240,180,41,0)');
    ctx.fillStyle=g; ctx.fillRect(x0,mt,x1-x0,chartH);
  }

  // Developing IB
  if(dev.h&&dev.l){
    const dTop=py(dev.h),dBot=py(dev.l),dH=dBot-dTop;
    if(!dev.complete){
      const pulse=0.5+0.5*Math.sin(Date.now()/350);
      ctx.fillStyle=`rgba(240,180,41,${0.03+pulse*0.04})`; ctx.fillRect(ml,dTop,W-ml-mr,dH);
      ctx.strokeStyle=`rgba(240,180,41,${0.4+pulse*0.5})`; ctx.lineWidth=1.5; ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.moveTo(ml,dTop); ctx.lineTo(W-mr,dTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ml,dBot); ctx.lineTo(W-mr,dBot); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle=`rgba(240,180,41,${0.6+pulse*0.4})`; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(ml,dTop); ctx.lineTo(ml+8,dTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ml,dBot); ctx.lineTo(ml+8,dBot); ctx.stroke();
      // Midpoint line (forming)
      const dMid=py(dev.mid);
      ctx.strokeStyle=`rgba(240,180,41,${0.25+pulse*0.2})`; ctx.lineWidth=1; ctx.setLineDash([3,5]);
      ctx.beginPath(); ctx.moveTo(ml,dMid); ctx.lineTo(W-mr,dMid); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=`rgba(240,180,41,${0.75+pulse*0.25})`;
      ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='right';
      ctx.fillText(`⟳ IB FORMING  ${dev.range.toFixed(2)}pts`,W-mr-6,dTop-5);
      ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='left';
      ctx.fillText(`H  ${dev.h.toFixed(2)}`,W-mr+3,dTop+3);
      ctx.fillStyle=`rgba(240,180,41,${0.5+pulse*0.2})`;
      ctx.fillText(`M  ${dev.mid.toFixed(2)}`,W-mr+3,dMid+3);
      ctx.fillStyle=`rgba(240,180,41,${0.75+pulse*0.25})`;
      ctx.fillText(`L  ${dev.l.toFixed(2)}`,W-mr+3,dBot+3);
      if(btTimer) requestAnimationFrame(()=>{ if(btTimer) btDraw(); });
    }else{
      ctx.fillStyle='rgba(240,180,41,0.05)'; ctx.fillRect(ml,dTop,W-ml-mr,dH);
      btHline(ctx,dTop,ml,W-mr,'rgba(240,180,41,0.95)',[],1.8);
      btHline(ctx,dBot,ml,W-mr,'rgba(240,180,41,0.95)',[],1.8);
      btHline(ctx,py(dev.mid),ml,W-mr,'rgba(240,180,41,0.3)',[4,5],1);
      ctx.fillStyle='rgba(240,180,41,0.12)'; ctx.fillRect(W-mr-100,dTop-17,100,14);
      ctx.fillStyle='rgba(240,180,41,0.8)'; ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='right';
      ctx.fillText(`IB  ${dev.range.toFixed(2)} pts`,W-mr-4,dTop-5);
      ctx.fillStyle='#f0b429'; ctx.textAlign='left';
      ctx.fillText(`H  ${dev.h.toFixed(2)}`,W-mr+3,dTop+3);
      ctx.fillStyle='rgba(240,180,41,0.7)';
      ctx.fillText(`M  ${dev.mid.toFixed(2)}`,W-mr+3,py(dev.mid)+3);
      ctx.fillText(`L  ${dev.l.toFixed(2)}`,W-mr+3,dBot+3);
    }
  }

  // Grid
  const step=niceStep(pMax-pMin,6);
  ctx.strokeStyle='rgba(255,255,255,0.028)'; ctx.lineWidth=1;
  for(let p=Math.ceil(pMin/step)*step;p<=pMax;p+=step){
    const y=py(p); ctx.beginPath(); ctx.moveTo(ml,y); ctx.lineTo(W-mr,y); ctx.stroke();
  }

  // Candles
  ctx.save(); ctx.beginPath(); ctx.rect(ml,mt,W-ml-mr,chartH); ctx.clip();
  candles.forEach((c,i)=>{
    const x=px(i); if(x<ml-cw*2||x>W-mr+cw) return;
    const bull=c.close>=c.open;
    const bW=Math.max(1,Math.floor(cw*0.7)),bX=Math.round(x-bW/2);
    const bTop=Math.round(Math.min(py(c.open),py(c.close)));
    const bBot=Math.round(Math.max(py(c.open),py(c.close)));
    const bH=Math.max(1,bBot-bTop),wX=Math.round(x);
    const col=bull?'#2962ff':'#ffffff';
    ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(wX,Math.round(py(c.high))); ctx.lineTo(wX,bTop);
    ctx.moveTo(wX,bBot); ctx.lineTo(wX,Math.round(py(c.low))); ctx.stroke();
    ctx.fillRect(bX,bTop,bW,bH);
  });
  ctx.restore();

  // VWAP
  if(vwap){
    ctx.save(); ctx.beginPath(); ctx.rect(ml,mt,W-ml-mr,chartH); ctx.clip();
    ctx.strokeStyle='#38bdf8'; ctx.lineWidth=1.4;
    ctx.shadowColor='rgba(56,189,248,0.2)'; ctx.shadowBlur=4;
    ctx.beginPath();
    candles.forEach((c,i)=>{ const x=px(i),y=py(vwap[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke(); ctx.shadowBlur=0; ctx.restore();
  }

  // Volume
  ctx.save(); ctx.beginPath(); ctx.rect(ml,volY,W-ml-mr,volH); ctx.clip();
  candles.forEach((c,i)=>{
    const x=px(i); if(x<ml-cw||x>W-mr+cw) return;
    const bh=(c.volume/maxVol)*(volH-2);
    ctx.fillStyle=c.close>=c.open?'rgba(41,98,255,0.4)':'rgba(255,255,255,0.2)';
    ctx.fillRect(x-cw*0.3,volY+volH-bh,cw*0.6,bh);
  });
  ctx.restore();
  ctx.fillStyle='rgba(107,115,138,0.28)'; ctx.font='7px Inter'; ctx.textAlign='right';
  ctx.fillText('VOL',W-mr-2,volY+8);

  // 10:30 marker
  if(ibCnt>0&&ibCnt<candles.length){
    const x=px(ibCnt)-cw*0.5;
    ctx.strokeStyle='rgba(240,180,41,0.3)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(x,mt); ctx.lineTo(x,mt+chartH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='rgba(240,180,41,0.6)'; ctx.font='bold 7px Inter'; ctx.textAlign='center';
    ctx.fillText('10:30',x,mt+chartH+11);
  }

  // BRACKET ORDER LINES
  if(tvBracket){
    const b=tvBracket;
    const isPending=b.status==='pending';
    const isActive=b.status==='active';
    const resolved=b.status==='tp_hit'||b.status==='sl_hit'||b.status==='manual';

    // Zone fills
    if(b.tp!=null&&b.entry!=null&&!resolved){
      const zt=py(Math.max(b.entry,b.tp)),zb=py(Math.min(b.entry,b.tp));
      ctx.fillStyle='rgba(52,217,116,0.04)'; ctx.fillRect(ml,zt,W-ml-mr,zb-zt);
    }
    if(b.sl!=null&&b.entry!=null&&!resolved){
      const zt=py(Math.max(b.entry,b.sl)),zb=py(Math.min(b.entry,b.sl));
      ctx.fillStyle='rgba(242,88,88,0.04)'; ctx.fillRect(ml,zt,W-ml-mr,zb-zt);
    }

    // Entry
    if(b.entry!=null){
      const ec=isActive?'rgba(245,200,66,0.9)':isPending?'rgba(245,200,66,0.5)':'rgba(245,200,66,0.3)';
      btHline(ctx,py(b.entry),ml,W-mr,ec,isPending?[6,4]:[],isPending?1:1.5);
      const arrow=b.dir==='long'?'▲':'▼';
      ctx.fillStyle=ec; ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='left';
      ctx.fillText(`${arrow} ENT ${b.entry.toFixed(2)}${isPending?' [LIMIT]':isActive?' ['+b.qty+'×'+b.instr+']':''}`,W-mr+3,py(b.entry)+3);
    }

    // TP
    if(b.tp!=null){
      const tpR=b.status==='tp_hit'; const tc=tpR?'#34d974':'rgba(52,217,116,0.8)';
      btHline(ctx,py(b.tp),ml,W-mr,tc,[],tpR?2.5:1.5);
      ctx.fillStyle=tc; ctx.font=`${tpR?'bold ':''}8px JetBrains Mono,monospace`; ctx.textAlign='left';
      ctx.fillText(tpR?`🎯 TP ${b.tp.toFixed(2)}`:`TP  ${b.tp.toFixed(2)}`,W-mr+3,py(b.tp)+3);
    }

    // SL
    if(b.sl!=null){
      const slR=b.status==='sl_hit'; const sc=slR?'#f25858':'rgba(242,88,88,0.8)';
      btHline(ctx,py(b.sl),ml,W-mr,sc,[],slR?2.5:1.5);
      ctx.fillStyle=sc; ctx.font='8px JetBrains Mono,monospace'; ctx.textAlign='left';
      ctx.fillText(slR?`🛑 SL ${b.sl.toFixed(2)}`:`SL  ${b.sl.toFixed(2)}`,W-mr+3,py(b.sl)+3);
    }

    // Live P&L connector
    if(isActive&&candles.length&&b.entry!=null){
      const cur=candles[candles.length-1].close;
      const lp=b.dir==='long'?(cur-b.entry):(b.entry-cur);
      const pv=TV_INSTRUMENTS[b.instr].pointValue*b.qty;
      const lc2=lp>=0?'rgba(52,217,116,0.5)':'rgba(242,88,88,0.5)';
      ctx.strokeStyle=lc2; ctx.lineWidth=1; ctx.setLineDash([2,3]);
      ctx.beginPath(); ctx.moveTo(W-mr-2,py(b.entry)); ctx.lineTo(W-mr-2,py(cur)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=lc2.replace('0.5)','0.9)');
      ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='right';
      const sign=lp>=0?'+':'';
      ctx.fillText(`${sign}$${(lp*pv).toFixed(0)}`,W-2,py(cur)-3);
    }
  }

  // Live price ticker
  if(candles.length){
    const last=candles[candles.length-1];
    const prev=candles.length>1?candles[candles.length-2]:last;
    const up=last.close>=prev.close;
    const cpY=Math.max(mt+8,Math.min(mt+chartH-8,py(last.close)));
    const priceCol=up?'#34d974':'#f25858';
    ctx.strokeStyle=up?'rgba(52,217,116,0.2)':'rgba(242,88,88,0.2)';
    ctx.lineWidth=1; ctx.setLineDash([2,5]);
    ctx.beginPath(); ctx.moveTo(ml,cpY); ctx.lineTo(W-mr,cpY); ctx.stroke(); ctx.setLineDash([]);
    const bW2=78,bH=16,bX=W-mr+1,bY=cpY-bH/2;
    ctx.fillStyle=priceCol;
    ctx.beginPath(); ctx.roundRect(bX,bY,bW2,bH,3); ctx.fill();
    ctx.fillStyle='#070b10'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(last.close.toFixed(2),bX+bW2/2,bY+bH-4);
    ctx.fillStyle='rgba(240,180,41,0.7)'; ctx.font='bold 9px Inter'; ctx.textAlign='right';
    ctx.fillText(`⏵ ${last.time}`,W-mr-6,mt+13);
  }

  // Right axis
  const stepA=niceStep(pMax-pMin,6);
  ctx.fillStyle='rgba(107,115,138,0.6)'; ctx.font='9px Inter'; ctx.textAlign='left';
  for(let p=Math.ceil(pMin/stepA)*stepA;p<=pMax;p+=stepA){
    const y=py(p); if(y<mt||y>mt+chartH) continue; ctx.fillText(p.toFixed(0),W-mr+3,y+3);
  }
  if(vwap&&vwap.length){
    ctx.fillStyle='#38bdf8'; ctx.font='bold 8px Inter';
    ctx.fillText(`V ${vwap[vwap.length-1].toFixed(1)}`,W-mr+3,py(vwap[vwap.length-1])+3);
  }

  // Time axis
  ctx.fillStyle='rgba(107,115,138,0.55)'; ctx.font='8px Inter'; ctx.textAlign='center';
  const every=Math.max(1,Math.ceil(n/10));
  candles.forEach((c,i)=>{ if(i%every!==0) return; const x=px(i); if(x<ml||x>W-mr) return; ctx.fillText(c.time,x,H-5); });
  ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(ml,mt+chartH); ctx.lineTo(W-mr,mt+chartH); ctx.stroke();

  // ── DRAFT LINES (before order placed) — only in draw mode ──
  if(btDrawMode&&(!tvBracket||tvBracket.status==='pending')){
    const draftTP=parseFloat(document.getElementById('tv-tp-px')?.value)||null;
    const draftSL=parseFloat(document.getElementById('tv-sl-px')?.value)||null;
    const draftLim=tvOrderType==='limit'?(parseFloat(document.getElementById('tv-limit-px')?.value)||null):null;
    const refPrice=btGetRefPrice();

    // Reference/entry line
    if(refPrice&&(!tvBracket||tvBracket.status!=='active')){
      btHline(ctx,py(refPrice),ml,W-mr,'rgba(245,200,66,0.35)',[4,3],1);
      const arrow=tvDir==='long'?'▲':'▼';
      const eLabel=tvOrderType==='limit'&&draftLim?`${arrow} LIMIT ${draftLim.toFixed(2)}`:`${arrow} MKT ~${refPrice.toFixed(2)}`;
      ctx.fillStyle='rgba(245,200,66,0.55)'; ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='left';
      ctx.fillText(eLabel,W-mr+3,py(refPrice)+3);
    }
    if(draftLim&&tvOrderType==='limit'){
      btHline(ctx,py(draftLim),ml,W-mr,'rgba(245,200,66,0.7)',[5,3],1.5);
      btDrawHandle(ctx,W-mr-60,py(draftLim),'rgba(245,200,66,0.8)',`LIM ${draftLim.toFixed(2)}`,'left','gold');
    }
    if(draftTP){
      btHline(ctx,py(draftTP),ml,W-mr,'rgba(52,217,116,0.7)',[5,3],1.5);
      btDrawHandle(ctx,W-mr-60,py(draftTP),'rgba(52,217,116,0.85)',`TP  ${draftTP.toFixed(2)}`,'left','green');
    }
    if(draftSL){
      btHline(ctx,py(draftSL),ml,W-mr,'rgba(242,88,88,0.7)',[5,3],1.5);
      btDrawHandle(ctx,W-mr-60,py(draftSL),'rgba(242,88,88,0.85)',`SL  ${draftSL.toFixed(2)}`,'left','red');
    }

    // "Click to place" hint when ref price known but no lines yet
    if(refPrice&&!draftTP&&!draftSL){
      ctx.fillStyle='rgba(107,115,138,0.45)'; ctx.font='9px Inter'; ctx.textAlign='center';
      ctx.fillText('Click chart to place TP / SL',ml+(W-ml-mr)/2,mt+20);
    }
  }

  // Drag handles on active bracket lines — only in draw mode
  if(btDrawMode&&tvBracket&&tvBracket.status!=='tp_hit'&&tvBracket.status!=='sl_hit'&&tvBracket.status!=='manual'){
    const b=tvBracket;
    if(b.tp!=null) btDrawHandle(ctx,W-mr-60,py(b.tp),'rgba(52,217,116,0.9)',`TP  ${b.tp.toFixed(2)}`,'left','green');
    if(b.sl!=null) btDrawHandle(ctx,W-mr-60,py(b.sl),'rgba(242,88,88,0.9)',`SL  ${b.sl.toFixed(2)}`,'left','red');
    if(b.status==='pending') btDrawHandle(ctx,W-mr-60,py(b.entry),'rgba(245,200,66,0.9)',`LIM ${b.entry.toFixed(2)}`,'left','gold');
  }

  // ── HOVER CROSSHAIR — only in draw mode ─────────
  if(btDrawMode&&_btHoverY!==null&&_btHoverY>=mt&&_btHoverY<=mt+chartH){
    const hPrice=btSnapPrice(btGetPrice(_btHoverY));
    const hy=py(hPrice);

    // Horizontal ghost line
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(ml,hy); ctx.lineTo(W-mr,hy); ctx.stroke(); ctx.setLineDash([]);

    // Price badge on right axis
    const bW=78,bH=16,bX=W-mr+1,bY=hy-bH/2;
    ctx.fillStyle='rgba(60,72,88,0.95)';
    ctx.beginPath(); ctx.roundRect(bX,bY,bW,bH,3); ctx.fill();
    ctx.strokeStyle='rgba(107,115,138,0.5)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(bX,bY,bW,bH,3); ctx.stroke();
    ctx.fillStyle='#dce8f7'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(hPrice.toFixed(2),bX+bW/2,bY+bH-4);

    // If in placement mode, show what will be placed
    if(!tvBracket&&btGetRefPrice()!==null){
      const ref=btGetRefPrice();
      const above=hPrice>ref;
      const isTP=(tvDir==='long'&&above)||(tvDir==='short'&&!above);
      const hint=isTP?'→ TP':'→ SL';
      const hintCol=isTP?'rgba(52,217,116,0.7)':'rgba(242,88,88,0.7)';
      ctx.fillStyle=hintCol; ctx.font='bold 9px Inter'; ctx.textAlign='right';
      ctx.fillText(hint,W-mr-6,hy-4);
    }
  }
}

function btHline(ctx,y,x1,x2,color,dash,width){
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width||1;
  ctx.setLineDash(dash||[]); ctx.beginPath();
  ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
}

// Draw a draggable handle pill on a price line
function btDrawHandle(ctx,x,y,color,label,align,colorKey){
  const colors={green:'rgba(52,217,116,',red:'rgba(242,88,88,',gold:'rgba(245,200,66,'};
  const base=colors[colorKey]||'rgba(107,115,138,';
  const W2=80,H2=16;
  // Drag grip indicator (small notch on left of pill)
  ctx.fillStyle=base+'0.18)';
  ctx.beginPath(); ctx.roundRect(x-W2/2,y-H2/2,W2,H2,3); ctx.fill();
  ctx.strokeStyle=color; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.roundRect(x-W2/2,y-H2/2,W2,H2,3); ctx.stroke();
  // Grip dots
  ctx.fillStyle=color;
  for(let i=-1;i<=1;i++){
    ctx.beginPath(); ctx.arc(x-W2/2+6,y+i*4,1,0,Math.PI*2); ctx.fill();
  }
  // Label
  ctx.fillStyle=color; ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='center';
  ctx.fillText(label,x+4,y+3);
}

// ═══════════════════════════════════════════════
// INTERACTIVE CHART — Pan, Zoom, Hover, Drag Lines
// ═══════════════════════════════════════════════

// Shared coordinate helpers — recomputed each frame and cached here
// so mouse handlers can convert pixels ↔ price without re-running btDraw
let _btChartMetrics=null; // {ml,mr,mt,chartH,pMin,pMax,py,pyInv}

function btGetPrice(canvasY){
  if(!_btChartMetrics) return null;
  const{mt,chartH,pMin,pMax}=_btChartMetrics;
  return pMin+(pMax-pMin)*(1-(canvasY-mt)/chartH);
}
function btSnapPrice(p){
  // Snap to 0.25 tick
  return Math.round(p*4)/4;
}

// Hover state
let _btHoverY=null; // canvas Y of mouse (or null)

// Drag state: which line is being dragged
// dragTarget: null | 'tp' | 'sl' | 'entry' | 'pan'
let _btDragTarget=null;
let _btDragStartX=0,_btDragStartPan=0;

// Hit-test: returns which draggable handle the mouse is near (within 8px)
function btHitTest(mouseY){
  if(!_btChartMetrics||!tvBracket) return null;
  const{py}=_btChartMetrics;
  const HIT=10; // px tolerance
  const b=tvBracket;
  // Only draggable before order is placed (pending/active check can still adjust TP/SL)
  if(b.status==='tp_hit'||b.status==='sl_hit'||b.status==='manual') return null;
  if(b.tp!=null&&Math.abs(mouseY-py(b.tp))<HIT) return 'tp';
  if(b.sl!=null&&Math.abs(mouseY-py(b.sl))<HIT) return 'sl';
  if(b.entry!=null&&Math.abs(mouseY-py(b.entry))<HIT) return 'entry';
  return null;
}

// Pre-placement hit test: are we near the draft lines (before order placed)?
function btHitDraft(mouseY){
  if(!_btChartMetrics) return null;
  const{py}=_btChartMetrics;
  const HIT=10;
  const tp=parseFloat(document.getElementById('tv-tp-px')?.value)||null;
  const sl=parseFloat(document.getElementById('tv-sl-px')?.value)||null;
  const lim=tvOrderType==='limit'?(parseFloat(document.getElementById('tv-limit-px')?.value)||null):null;
  if(tp&&Math.abs(mouseY-py(tp))<HIT) return 'tp';
  if(sl&&Math.abs(mouseY-py(sl))<HIT) return 'sl';
  if(lim&&Math.abs(mouseY-py(lim))<HIT) return 'limit';
  return null;
}

function btGetCursorForY(mouseY){
  if(!btCandles||!btTrade) return 'crosshair';
  if(tvBracket&&tvBracket.status!=='tp_hit'&&tvBracket.status!=='sl_hit'&&tvBracket.status!=='manual'){
    if(btHitTest(mouseY)) return 'ns-resize';
  } else if(!tvBracket){
    if(btHitDraft(mouseY)) return 'ns-resize';
  }
  return 'crosshair';
}

let _btCrosshairInit=false;
function btInitCrosshair(){
  if(_btCrosshairInit) return; _btCrosshairInit=true;
  const canvas=document.getElementById('btCanvas');

  // ── mousemove ──
  canvas.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    _btHoverY=btDrawMode?my:null; // crosshair only in draw mode

    if(_btDragTarget==='pan'){
      btPanOffset=_btDragStartPan+(e.clientX-_btDragStartX);
      btDraw(); return;
    }

    if(btDrawMode&&_btDragTarget&&_btChartMetrics){
      const price=btSnapPrice(btGetPrice(my));
      if(_btDragTarget==='tp'){
        const el=document.getElementById('tv-tp-px');
        if(el){ el.value=price.toFixed(2); tvUpdateCalc(); }
        if(tvBracket&&tvBracket.tp!=null) tvBracket.tp=price;
      } else if(_btDragTarget==='sl'){
        const el=document.getElementById('tv-sl-px');
        if(el){ el.value=price.toFixed(2); tvUpdateCalc(); }
        if(tvBracket&&tvBracket.sl!=null) tvBracket.sl=price;
      } else if(_btDragTarget==='limit'){
        const elE=document.getElementById('tv-limit-px');
        if(elE&&tvOrderType==='limit'){ elE.value=price.toFixed(2); tvUpdateCalc(); }
        if(tvBracket&&tvBracket.entry!=null&&tvBracket.status==='pending') tvBracket.entry=price;
      }
      btDraw(); return;
    }

    // Cursor
    if(btDrawMode) canvas.style.cursor=btGetCursorForY(my);
    else canvas.style.cursor='grab';
    btDraw();
  });

  canvas.addEventListener('mouseleave',()=>{
    _btHoverY=null;
    canvas.style.cursor=btDrawMode?'crosshair':'grab';
    btDraw();
  });

  // ── mousedown ──
  canvas.addEventListener('mousedown',e=>{
    if(e.button!==0) return;
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;

    if(btDrawMode){
      // Draw mode: check drag handles first
      if(tvBracket){
        const hit=btHitTest(my);
        if(hit){ _btDragTarget=hit; e.preventDefault(); return; }
      }
      if(!tvBracket){
        const dHit=btHitDraft(my);
        if(dHit){ _btDragTarget=dHit; e.preventDefault(); return; }
      }
      // Click-to-place TP/SL
      if(_btChartMetrics&&btTrade){
        const price=btSnapPrice(btGetPrice(my));
        const refPrice=btGetRefPrice();
        if(refPrice!==null){
          const above=price>refPrice;
          const isTP=(tvDir==='long'&&above)||(tvDir==='short'&&!above);
          const el=document.getElementById(isTP?'tv-tp-px':'tv-sl-px');
          if(el){ el.value=price.toFixed(2); tvUpdateCalc(); }
          btDraw(); return;
        }
      }
      return; // draw mode: never pan
    }

    // Pan mode — always pan
    _btDragTarget='pan';
    _btDragStartX=e.clientX;
    _btDragStartPan=btPanOffset;
    canvas.style.cursor='grabbing';
  });

  // ── mouseup ──
  window.addEventListener('mouseup',()=>{
    _btDragTarget=null;
    const c=document.getElementById('btCanvas');
    if(c) c.style.cursor=btDrawMode?'crosshair':'grab';
  });

  // ── wheel zoom ──
  canvas.addEventListener('wheel',e=>{
    e.preventDefault(); if(!btCandles) return;
    const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left;
    const ml=8,mr=84,cW=canvas.clientWidth-ml-mr;
    const oCw=Math.max(3,cW/btCandles.length*btZoom);
    const fL=(mx-ml-btPanOffset)/oCw;
    const fac=e.ctrlKey?0.0008:0.0018;
    btZoom=Math.max(0.2,Math.min(15,btZoom*(1+(-e.deltaY*fac))));
    const nCw=Math.max(3,cW/btCandles.length*btZoom);
    btPanOffset=mx-ml-fL*nCw;
    btDraw();
  },{passive:false});
}

// Get the reference price (current close for market, limit px for limit)
function btGetRefPrice(){
  if(tvOrderType==='limit'){
    const lim=parseFloat(document.getElementById('tv-limit-px')?.value);
    return isNaN(lim)?null:lim;
  }
  if(!btRawCandles||!btRawLimit) return null;
  const c=btRawCandles[Math.min(btRawLimit-1,btRawCandles.length-1)];
  return c?c.close:null;
}

let _btResizeInit=false;
function btInitResize(){
  if(_btResizeInit) return; _btResizeInit=true;
  window.addEventListener('resize',()=>{ if(btTrade&&currentView==='backtest') btDraw(); });
}