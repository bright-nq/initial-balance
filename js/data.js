'use strict';

// FILE / DATA
// ═══════════════════════════════════════════════
let rawTrades=[],allOhlcvFiles={},ohlcvFiles={},ohlcvCache={},resultsLoaded=false;
const DATA_DIR='data/',RESULTS_FILE_ENC=DATA_DIR+'ib_all_results.arrow.enc',YEAR_RANGE=[2010,2026];

async function fetchRaw(url){ try{ const r=await fetch(url); if(!r.ok) return null; return r.arrayBuffer(); }catch{ return null; } }
async function fetchDecrypt(url){
  const buf=await fetchRaw(url); if(!buf) return null;
  try{ const salt=new Uint8Array(buf).slice(0,SALT_LEN),key=await deriveKey(_password,salt); return await decryptBuffer(buf,key); }
  catch(e){ console.error('decrypt failed',url,e); return null; }
}
function getArrow(){ return window.Arrow||window.apache_arrow||null; }
async function waitForArrow(ms=10000){
  return new Promise((res,rej)=>{ let t=0; const c=()=>{ if(getArrow()) return res(); if(t++>ms/100) return rej(new Error('Arrow CDN failed')); setTimeout(c,100); }; c(); });
}
async function probeYear(year){
  const url=DATA_DIR+`nq_ohlcv_${year}.arrow.enc`,T=6000;
  const go=async()=>{
    try{ if((await fetch(url,{method:'HEAD'})).ok) return year; }catch(_){}
    try{ const r=await fetch(url,{headers:{Range:'bytes=0-3'}}); if(r.ok||r.status===206) return year; }catch(_){}
    try{ if((await fetch(url)).ok) return year; }catch(_){}
    return null;
  };
  return Promise.race([go(),new Promise(r=>setTimeout(()=>r(null),T))]);
}
async function scanDataDir(resultsBuf){
  const sc=document.getElementById('step-scanning');
  sc.textContent='Decrypting results…';
  let plainBuf; try{ plainBuf=await decryptBuffer(resultsBuf,_cryptoKey); }
  catch(e){ sc.innerHTML=`<span style="color:var(--red)">✗ Decrypt error: ${e.message}</span>`; return; }
  try{
    rawTrades=await parseArrowBuffer(plainBuf,'results'); resultsLoaded=true;
    document.getElementById('dot-results').classList.add('ok');
    document.getElementById('val-results').textContent=rawTrades.length.toLocaleString()+' rows ⚡';
  }catch(e){ sc.innerHTML=`<span style="color:var(--red)">✗ Parse error: ${e.message}</span>`; return; }
  sc.textContent='Scanning for OHLCV files…';
  const yearsInResults=[...new Set(rawTrades.map(r=>+r.year))].filter(Boolean).sort();
  const allYears=[...new Set([...yearsInResults,...Array.from({length:YEAR_RANGE[1]-YEAR_RANGE[0]+1},(_,i)=>YEAR_RANGE[0]+i)])].sort();
  const found=[];
  for(let i=0;i<allYears.length;i+=4){
    const batch=allYears.slice(i,i+4);
    (await Promise.all(batch.map(probeYear))).forEach(y=>{ if(y!==null) found.push(y); });
    if(found.length>0) sc.textContent=`Found: ${found.join(', ')} — scanning…`;
  }
  if(found.length===0&&yearsInResults.length>0){
    for(const y of yearsInResults){ try{ if((await fetch(DATA_DIR+`nq_ohlcv_${y}.arrow.enc`)).ok) found.push(y); }catch(_){} }
  }
  found.forEach(y=>{ allOhlcvFiles[y]=true; });
  sc.style.display='none';
  const card=document.getElementById('step-years'); card.style.display='flex';
  if(found.length===0){
    document.getElementById('year-checkboxes').innerHTML=`<span style="color:var(--text-dim);font-size:10px;">No nq_ohlcv_YYYY.arrow.enc found in data/</span>`;
    ohlcvFiles={};
  }else buildYearCheckboxes();
  updateLaunchBtn();
}
function buildYearCheckboxes(){
  const c=document.getElementById('year-checkboxes'); c.innerHTML='';
  Object.keys(allOhlcvFiles).map(Number).sort().forEach(y=>{
    const label=document.createElement('label');
    label.className='ld-yr-chip on';
    label.innerHTML=`<input type="checkbox" value="${y}" checked onchange="onYearToggle(this)">${y}`;
    c.appendChild(label);
  });
  ohlcvFiles={...allOhlcvFiles};
}
function onYearToggle(cb){
  cb.closest('label').classList.toggle('on',cb.checked);
  ohlcvFiles={};
  document.querySelectorAll('#year-checkboxes input:checked').forEach(c=>{ ohlcvFiles[+c.value]=true; });
  updateLaunchBtn();
}
function selectAllYears(){ document.querySelectorAll('#year-checkboxes input').forEach(cb=>{ cb.checked=true; cb.closest('label').classList.add('on'); }); ohlcvFiles={...allOhlcvFiles}; updateLaunchBtn(); }
function selectNoYears(){ document.querySelectorAll('#year-checkboxes input').forEach(cb=>{ cb.checked=false; cb.closest('label').classList.remove('on'); }); ohlcvFiles={}; updateLaunchBtn(); }
function updateLaunchBtn(){ document.getElementById('btn-load').classList.toggle('ready',resultsLoaded); }

async function parseArrowBuffer(buf,type){
  const Arrow=getArrow(); if(!Arrow) throw new Error('Arrow not loaded');
  const table=Arrow.tableFromIPC(new Uint8Array(buf));
  if(type==='results'){
    const rows=[];
    for(let i=0;i<table.numRows;i++){ const row={}; for(const f of table.schema.fields){ const v=table.getChild(f.name).get(i); row[f.name]=v===null?'':String(v); } rows.push(row); }
    return rows.filter(r=>r.date);
  }
  return table;
}
async function parseArrowOHLCVTable(table,year){
  const dateCol=table.getChild('date'),timeCol=table.getChild('time'),
    openCol=table.getChild('open'),highCol=table.getChild('high'),
    lowCol=table.getChild('low'),closeCol=table.getChild('close'),
    volumeCol=table.getChild('volume'),symCol=table.getChild('symbol'),n=table.numRows;
  let primarySym=null;
  if(symCol){
    const dv={};
    for(let i=0;i<n;i++){ const d=String(dateCol.get(i)),s=String(symCol.get(i)),v=volumeCol?(volumeCol.get(i)||0):0; if(!dv[d])dv[d]={}; dv[d][s]=(dv[d][s]||0)+v; }
    primarySym={};
    for(const[d,sv]of Object.entries(dv)) primarySym[d]=Object.entries(sv).sort((a,b)=>b[1]-a[1])[0][0];
  }
  const buckets={};
  for(let i=0;i<n;i++){
    const d=String(dateCol.get(i)),t=String(timeCol.get(i));
    if(t<'09:30'||t>='16:00') continue;
    if(primarySym&&symCol&&String(symCol.get(i))!==primarySym[d]) continue;
    const bKey=t.slice(0,5);
    if(!buckets[d])buckets[d]={};
    if(!buckets[d][bKey])buckets[d][bKey]={time:bKey,open:openCol.get(i),high:-Infinity,low:Infinity,close:0,volume:0};
    const b=buckets[d][bKey];
    b.high=Math.max(b.high,highCol.get(i)); b.low=Math.min(b.low,lowCol.get(i));
    b.close=closeCol.get(i); b.volume+=volumeCol?(volumeCol.get(i)||0):0;
  }
  if(!ohlcvCache[year])ohlcvCache[year]={};
  for(const[d,bMap]of Object.entries(buckets))
    ohlcvCache[year][d]=Object.values(bMap).sort((a,b)=>a.time.localeCompare(b.time));
}
async function ensureYearCached(year){
  if(ohlcvCache[year]||!ohlcvFiles[year]) return;
  const pb=document.getElementById('progress-bar'); pb.style.display='block'; setProgress(20);
  const plainBuf=await fetchDecrypt(DATA_DIR+`nq_ohlcv_${year}.arrow.enc`);
  if(plainBuf){ const Arrow=getArrow(),table=Arrow.tableFromIPC(new Uint8Array(plainBuf)); ohlcvCache[year]={}; await parseArrowOHLCVTable(table,year); }
  setProgress(100); setTimeout(()=>{ pb.style.display='none'; setProgress(0); },400);
}
function setProgress(pct){ document.getElementById('progress-fill').style.width=pct+'%'; }
async function getCandlesForDate(dateStr){ const y=+dateStr.slice(0,4); await ensureYearCached(y); return(ohlcvCache[y]&&ohlcvCache[y][dateStr])||null; }
function addMinutes(t,m){ const[h,min]=t.split(':').map(Number),tot=h*60+min+m; return`${String(Math.min(Math.floor(tot/60),23)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`; }
function computeVWAP(candles){ let ctpv=0,cv=0; return candles.map(c=>{ const tp=(c.high+c.low+c.close)/3; ctpv+=tp*c.volume; cv+=c.volume; return cv>0?ctpv/cv:tp; }); }

// ═══════════════════════════════════════════════