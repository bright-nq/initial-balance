'use strict';

// CHART DRAWING
// ═══════════════════════════════════════════════
function getCanvas(){
  const canvas=document.getElementById('chartCanvas'),area=document.getElementById('chart-area');
  const dpr=window.devicePixelRatio||1;
  const cssW=area.clientWidth,cssH=area.clientHeight;
  // Always resize to match current DPR — ensures crisp rendering at any browser zoom
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  const ctx=canvas.getContext('2d');
  // Scale ctx so all drawing coordinates are in CSS pixels regardless of DPR
  ctx.scale(dpr,dpr);
  return {canvas,ctx,W:cssW,H:cssH};
}
function drawChartLoading(){
  const {ctx,W,H}=getCanvas();
  ctx.fillStyle='#080b10'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(150,180,208,0.5)'; ctx.font='13px Inter,sans-serif'; ctx.textAlign='center';
  ctx.fillText('Loading candles…',W/2,H/2);
}

let replayLimit=undefined;

function drawChart(cxX,cxY){
  if(!selectedTrade) return;
  const {canvas,ctx,W,H}=getCanvas(),t=selectedTrade;
  ctx.fillStyle='#070b10'; ctx.fillRect(0,0,W,H);
  const allC=selectedCandles;
  if(!allC||!allC.length){ drawNoData(ctx,W,H,t); return; }
  const limit=replayMode&&replayLimit!==undefined?replayLimit:allC.length;
  const candles=allC.slice(0,Math.max(1,limit));
  const vwap=selectedVWAP?selectedVWAP.slice(0,candles.length):null;
  const n=candles.length;
  const ml=8,mr=72,mt=24;
  const volH=layers.volume?44:0,mb=30+volH,chartH=H-mt-mb,chartW=W-ml-mr;
  const cw=Math.max(3,chartW/allC.length*zoom);
  function px(i){ return ml+i*cw+cw*0.5+panOffset; }
  let minP=Infinity,maxP=-Infinity;
  candles.forEach(c=>{ minP=Math.min(minP,c.low); maxP=Math.max(maxP,c.high); });
  if(t._ib_high){ minP=Math.min(minP,t._ib_low-2); maxP=Math.max(maxP,t._ib_high+2); }
  const pad=(maxP-minP)*0.07,pMin=minP-pad,pMax=maxP+pad;
  function py(p){ return mt+chartH-((p-pMin)/(pMax-pMin))*chartH; }
  const maxVol=Math.max(...candles.map(c=>c.volume),1),volY=mt+chartH+4;

  if(layers.ibzone){
    const ibCnt=candles.filter(c=>c.time<'10:30').length;
    if(ibCnt>0){
      const x0=px(0)-cw*0.5,x1=px(ibCnt-1)+cw*0.5;
      const grd=ctx.createLinearGradient(x0,0,x1,0);
      grd.addColorStop(0,'rgba(240,180,41,0)'); grd.addColorStop(.15,'rgba(240,180,41,0.04)');
      grd.addColorStop(.85,'rgba(240,180,41,0.04)'); grd.addColorStop(1,'rgba(240,180,41,0)');
      ctx.fillStyle=grd; ctx.fillRect(x0,mt,x1-x0,chartH);
      ctx.fillStyle='rgba(240,180,41,0.28)'; ctx.font='8px Inter,sans-serif'; ctx.textAlign='center';
      ctx.fillText('INITIAL BALANCE',(x0+x1)/2,mt+10);
    }
  }
  if(layers.grid){
    const step=niceStep(pMax-pMin,6);
    ctx.strokeStyle='rgba(255,255,255,0.028)'; ctx.lineWidth=1;
    for(let p=Math.ceil(pMin/step)*step;p<=pMax;p+=step){ const y=py(p); ctx.beginPath(); ctx.moveTo(ml,y); ctx.lineTo(W-mr,y); ctx.stroke(); }
  }
  if(layers.ib&&t._ib_high){
    ctx.fillStyle='rgba(240,180,41,0.022)';
    ctx.fillRect(ml,py(t._ib_high),W-ml-mr,py(t._ib_low)-py(t._ib_high));
    hline(ctx,py(t._ib_high),ml,W-mr,'#f0b429',[6,4],1.2);
    hline(ctx,py(t._ib_low),ml,W-mr,'#f0b429',[6,4],1.2);
    hline(ctx,py(t._ib_mid),ml,W-mr,'rgba(240,180,41,0.28)',[3,5],1);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(ml,mt,W-ml-mr,chartH); ctx.clip();
  candles.forEach((c,i)=>{
    const x=px(i); if(x<ml-cw*2||x>W-mr+cw) return;
    const bull=c.close>=c.open;
    const bodyW=Math.max(1,Math.floor(cw*0.7)),bodyX=Math.round(x-bodyW/2);
    const bodyTop=Math.round(Math.min(py(c.open),py(c.close)));
    const bodyBottom=Math.round(Math.max(py(c.open),py(c.close)));
    const bodyH=Math.max(1,bodyBottom-bodyTop),wickX=Math.round(x);
    const col=bull?'#2962ff':'#ffffff';
    ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(wickX,Math.round(py(c.high))); ctx.lineTo(wickX,bodyTop);
    ctx.moveTo(wickX,bodyBottom); ctx.lineTo(wickX,Math.round(py(c.low))); ctx.stroke();
    ctx.fillRect(bodyX,bodyTop,bodyW,bodyH);
  });
  ctx.restore();
  if(layers.vwap&&vwap){
    ctx.save(); ctx.beginPath(); ctx.rect(ml,mt,W-ml-mr,chartH); ctx.clip();
    ctx.strokeStyle='#38bdf8'; ctx.lineWidth=1.4; ctx.shadowColor='rgba(56,189,248,0.25)'; ctx.shadowBlur=4; ctx.setLineDash([]);
    ctx.beginPath();
    candles.forEach((c,i)=>{ const x=px(i),y=py(vwap[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke(); ctx.shadowBlur=0; ctx.restore();
  }
  if(layers.volume){
    ctx.save(); ctx.beginPath(); ctx.rect(ml,volY,W-ml-mr,volH); ctx.clip();
    candles.forEach((c,i)=>{
      const x=px(i); if(x<ml-cw||x>W-mr+cw) return;
      const bh=(c.volume/maxVol)*(volH-2);
      ctx.fillStyle=c.close>=c.open?'rgba(41,98,255,0.4)':'rgba(255,255,255,0.2)';
      ctx.fillRect(x-cw*0.3,volY+volH-bh,cw*0.6,bh);
    });
    ctx.restore();
    ctx.fillStyle='rgba(107,115,138,0.32)'; ctx.font='7px Inter'; ctx.textAlign='right';
    ctx.fillText('VOL',W-mr-2,volY+8);
  }
  if(layers.markers&&!replayMode){
    const ibEndIdx=candles.filter(c=>c.time<'10:30').length;
    if(ibEndIdx>0&&ibEndIdx<candles.length){
      const x=px(ibEndIdx)-cw*0.5;
      ctx.strokeStyle='rgba(240,180,41,0.28)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
      ctx.beginPath(); ctx.moveTo(x,mt); ctx.lineTo(x,mt+chartH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='rgba(240,180,41,0.45)'; ctx.font='8px Inter,sans-serif'; ctx.textAlign='center';
      ctx.fillText('10:30',x,mt+chartH+12);
    }
    const tgtTime=addMinutes('10:30',Math.ceil(t.minutes_to_break));
    let brkIdx=candles.findIndex(c=>c.time>=tgtTime);
    if(brkIdx<0) brkIdx=candles.length-1;
    if(brkIdx>=0){
      const c=candles[brkIdx],x=px(brkIdx);
      const upBreak=t.first_break==='High',ay=upBreak?py(c.high)-14:py(c.low)+14;
      ctx.fillStyle=upBreak?'rgba(34,197,94,0.9)':'rgba(239,68,68,0.9)';
      ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.fillText(upBreak?'▲':'▼',x,ay);
      ctx.font='7px Inter,sans-serif';
      ctx.fillStyle=t.is_winner?'rgba(34,197,94,0.8)':'rgba(239,68,68,0.8)';
      ctx.fillText(t.is_winner?'WIN':'LOSS',x,ay+(upBreak?-8:11));
    }
  }
  if(replayMode&&candles.length){
    const last=candles[candles.length-1];
    ctx.fillStyle='rgba(240,180,41,0.7)'; ctx.font='bold 10px Inter'; ctx.textAlign='right';
    ctx.fillText(`⏵ ${last.time}`,W-mr-4,mt+14);
  }
  if(cxX!==undefined&&!replayMode){
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(cxX,mt); ctx.lineTo(cxX,mt+chartH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ml,cxY); ctx.lineTo(W-mr,cxY); ctx.stroke();
    ctx.setLineDash([]);
    const hp=pMin+((mt+chartH-cxY)/chartH)*(pMax-pMin);
    ctx.fillStyle='rgba(240,180,41,0.9)'; ctx.font='bold 9px Inter'; ctx.textAlign='left';
    ctx.fillText(hp.toFixed(2),W-mr+3,cxY+3);
  }
  const step=niceStep(pMax-pMin,6);
  ctx.fillStyle='rgba(107,115,138,0.65)'; ctx.font='9px Inter'; ctx.textAlign='left';
  for(let p=Math.ceil(pMin/step)*step;p<=pMax;p+=step){
    const y=py(p); if(y<mt||y>mt+chartH) continue;
    ctx.fillText(p.toFixed(0),W-mr+3,y+3);
  }
  if(layers.ib&&t._ib_high){
    ctx.font='bold 8px Inter';
    [[t._ib_high,`H ${t._ib_high.toFixed(1)}`,'#f0b429'],[t._ib_low,`L ${t._ib_low.toFixed(1)}`,'#f0b429'],[t._ib_mid,`M ${t._ib_mid.toFixed(1)}`,'rgba(240,180,41,0.4)']].forEach(([p,lbl,col])=>{
      ctx.fillStyle=col; ctx.textAlign='left'; ctx.fillText(lbl,W-mr+3,py(p)+3);
    });
  }
  if(layers.vwap&&vwap&&vwap.length){
    const lv=vwap[vwap.length-1];
    ctx.fillStyle='#38bdf8'; ctx.font='bold 8px Inter'; ctx.textAlign='left';
    ctx.fillText(`V ${lv.toFixed(1)}`,W-mr+3,py(lv)+3);
  }
  ctx.fillStyle='rgba(107,115,138,0.55)'; ctx.font='8px Inter'; ctx.textAlign='center';
  const every=Math.max(1,Math.ceil(n/10));
  candles.forEach((c,i)=>{ if(i%every!==0) return; const x=px(i); if(x<ml||x>W-mr) return; ctx.fillText(c.time,x,H-(layers.volume?mb-volH-3:5)); });
  ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(ml,mt+chartH); ctx.lineTo(W-mr,mt+chartH); ctx.stroke();
}
function drawNoData(ctx,W,H,t){
  ctx.fillStyle='rgba(107,115,138,0.3)'; ctx.font='11px Inter'; ctx.textAlign='center';
  ctx.fillText(`No OHLCV — nq_ohlcv_${t.date.slice(0,4)}.arrow.enc`,W/2,H/2-8);
  ctx.font='10px Inter'; ctx.fillStyle='rgba(107,115,138,0.18)';
  ctx.fillText(`IB ${t._ib_range_pts.toFixed(1)}pt · ${t.minutes_to_break.toFixed(0)}min to ${t.first_break}`,W/2,H/2+12);
  if(t._ib_high){
    const ml2=12,mr2=80,mt2=50,cH2=H-mt2-80,sp=t._ib_high-t._ib_low;
    const pm=t._ib_low-sp*0.5,pmx=t._ib_high+sp*0.5,py2=p=>mt2+cH2-((p-pm)/(pmx-pm))*cH2;
    hline(ctx,py2(t._ib_high),ml2,W-mr2,'#f0b429',[6,4],1.1);
    hline(ctx,py2(t._ib_low),ml2,W-mr2,'#f0b429',[6,4],1.1);
    ctx.fillStyle='#f0b429'; ctx.font='8px Inter'; ctx.textAlign='left';
    ctx.fillText(`H ~${t._ib_high.toFixed(1)}`,W-mr2+3,py2(t._ib_high)+3);
    ctx.fillText(`L ~${t._ib_low.toFixed(1)}`,W-mr2+3,py2(t._ib_low)+3);
  }
}
function hline(ctx,y,x1,x2,color,dash,width){
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
}
function niceStep(range,n){ const r=range/n,mag=Math.pow(10,Math.floor(Math.log10(r))),norm=r/mag; return(norm<1.5?1:norm<3?2:norm<7?5:10)*mag; }

// ═══════════════════════════════════════════════
// PAN + ZOOM
// ═══════════════════════════════════════════════
function setupCrosshair(){
  const canvas=document.getElementById('chartCanvas'),tt=document.getElementById('tt');
  canvas.addEventListener('mousemove',e=>{
    if(!selectedCandles||replayMode){ tt.classList.remove('visible'); return; }
    const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    const ml=8,mr=72,chartW=(canvas.clientWidth||canvas.width)-ml-mr;
    const cw=Math.max(3,chartW/selectedCandles.length*zoom);
    const idx=Math.round((mx-ml-panOffset-cw*0.5)/cw);
    if(idx<0||idx>=selectedCandles.length){ tt.classList.remove('visible'); drawChart(); return; }
    const c=selectedCandles[idx],v=selectedVWAP?selectedVWAP[idx]:null;
    document.getElementById('tt-time').textContent=c.time;
    document.getElementById('tt-o').textContent=c.open.toFixed(2);
    document.getElementById('tt-h').textContent=c.high.toFixed(2);
    document.getElementById('tt-l').textContent=c.low.toFixed(2);
    document.getElementById('tt-c').textContent=c.close.toFixed(2);
    document.getElementById('tt-c').style.color=c.close>=c.open?'#2962ff':'#ffffff';
    document.getElementById('tt-v').textContent=v?v.toFixed(2):'—';
    document.getElementById('tt-vol').textContent=c.volume.toLocaleString();
    document.getElementById('tt-phase').textContent=c.time<'10:30'?'IB':'Post-IB';
    let left=mx+14,top=my-8;
    if(left+155>(canvas.clientWidth||canvas.width)) left=mx-170;
    if(top+175>(canvas.clientHeight||canvas.height)) top=my-180;
    tt.style.left=left+'px'; tt.style.top=top+'px';
    tt.classList.add('visible');
    drawChart(mx,my);
  });
  canvas.addEventListener('mouseleave',()=>{ tt.classList.remove('visible'); drawChart(); });
}
function setupPan(){
  const canvas=document.getElementById('chartCanvas');
  let drag=false,sx=0,sp=0;
  canvas.addEventListener('mousedown',e=>{ if(e.button===0){ drag=true; sx=e.clientX; sp=panOffset; canvas.style.cursor='grabbing'; } });
  window.addEventListener('mousemove',e=>{ if(!drag) return; panOffset=sp+(e.clientX-sx); drawChart(); });
  window.addEventListener('mouseup',()=>{ drag=false; canvas.style.cursor='crosshair'; });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault(); if(!selectedCandles) return;
    const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left;
    const ml=8,mr=72,chartW=(canvas.clientWidth||canvas.width)-ml-mr;
    const oldCw=Math.max(3,chartW/selectedCandles.length*zoom);
    const fromLeft=(mx-ml-panOffset)/oldCw;
    const factor=e.ctrlKey?0.0008:0.0018;
    zoom=Math.max(0.2,Math.min(15,zoom*(1+(-e.deltaY*factor))));
    const newCw=Math.max(3,chartW/selectedCandles.length*zoom);
    panOffset=mx-ml-fromLeft*newCw;
    drawChart();
  },{passive:false});
}
function adjustZoom(d){
  if(!selectedCandles) return;
  const canvas=document.getElementById('chartCanvas');
  const ml=8,mr=72,chartW=(canvas.clientWidth||canvas.width)-ml-mr,cx=chartW/2;
  const oldCw=Math.max(3,chartW/selectedCandles.length*zoom);
  const fromLeft=(cx-panOffset)/oldCw;
  zoom=Math.max(0.2,Math.min(15,zoom*(d>0?1.25:0.8)));
  const newCw=Math.max(3,chartW/selectedCandles.length*zoom);
  panOffset=cx-fromLeft*newCw;
  drawChart();
}
function resetZoom(){ zoom=1; panOffset=0; drawChart(); }
function toggleLayer(name){ layers[name]=!layers[name]; document.getElementById(`btn-${name}`).classList.toggle('on',layers[name]); drawChart(); }

// ═══════════════════════════════════════════════