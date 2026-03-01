'use strict';

// CRYPTO
// ═══════════════════════════════════════════════
const PBKDF2_ITERS=200_000,SALT_LEN=16,NONCE_LEN=12;
let _cryptoKey=null,_password=null;

async function deriveKey(pw,salt){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITERS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
}
async function decryptBuffer(encBuf,key){
  const b=new Uint8Array(encBuf),nonce=b.slice(SALT_LEN,SALT_LEN+NONCE_LEN),ct=b.slice(SALT_LEN+NONCE_LEN);
  return crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,ct);
}
async function checkPass(){
  const pw=document.getElementById('pass-input').value; if(!pw) return;
  const inp=document.getElementById('pass-input'),err=document.getElementById('pass-err');
  inp.disabled=true; err.style.opacity='0';
  document.getElementById('loader').style.display='flex';
  document.getElementById('step-scanning').textContent='Deriving key…';
  try{ await waitForArrow(); }catch(e){ _fail(inp,err,'Arrow CDN failed'); return; }
  const encBuf=await fetchRaw(RESULTS_FILE_ENC);
  if(!encBuf){ _fail(inp,err,'Cannot load data — is the server running?'); return; }
  const salt=new Uint8Array(encBuf).slice(0,SALT_LEN);
  let key;
  try{ key=await deriveKey(pw,salt); await decryptBuffer(encBuf,key); }
  catch(_){
    document.getElementById('loader').style.display='none';
    document.getElementById('passlock').style.display='flex';
    document.getElementById('step-scanning').textContent='Initialising…';
    err.textContent='Incorrect password'; err.style.opacity='1';
    inp.disabled=false; inp.value=''; inp.style.borderColor='var(--red)';
    setTimeout(()=>inp.style.borderColor='',1000); return;
  }
  _cryptoKey=key; _password=pw; inp.disabled=false;
  const pl=document.getElementById('passlock');
  pl.style.transition='opacity .25s'; pl.style.opacity='0';
  setTimeout(()=>pl.style.display='none',250);
  scanDataDir(encBuf);
}
function _fail(inp,err,msg){
  document.getElementById('loader').style.display='none';
  document.getElementById('passlock').style.display='flex';
  document.getElementById('step-scanning').textContent='Initialising…';
  err.textContent=msg; err.style.opacity='1'; inp.disabled=false;
}
window.addEventListener('load',()=>{
  const inp=document.getElementById('pass-input'); inp.focus();
  inp.addEventListener('focus',()=>inp.style.borderColor='var(--gold)');
  inp.addEventListener('blur',()=>inp.style.borderColor='');
});

// ═══════════════════════════════════════════════