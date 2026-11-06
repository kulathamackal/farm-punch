// Kulathamackal Farm Tracker — owners' app (v1, 06/11/2026). Keeps the tracker page and the last data on the phone, opens at once,
// refreshes in the background, and asks the owner PIN only once per phone (the farm app gives the phone its own token).
const EXEC = 'https://script.google.com/macros/s/AKfycbzvUFuUZ7MZuC6CDvaMf-Ej1-NJYm3dosqsHsZehHDyXxVO0IhPlNoBzt1-RaRdGzrmtQ/exec';
const STALE = 150000;   // refresh the data when the copy on the phone is older than 2½ minutes
const LS = { get: k => { try { return localStorage.getItem('oa_' + k); } catch (e) { return null; } },
             set: (k, v) => { try { localStorage.setItem('oa_' + k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem('oa_' + k); } catch (e) {} } };
const $ = id => document.getElementById(id), F = $('f');
let TOK = LS.get('tok'), BY = LS.get('by') || 'kurian', inflight = null;
const OA = window.OA = { main: '' };

async function post(body) {
  const r = await fetch(EXEC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ app: 'owner' }, body)) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}
function bar(t, err) { const b = $('bar'); b.textContent = t || ''; b.className = err ? 'err' : ''; b.style.display = t ? 'block' : 'none'; }
function ago(ms) { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; }
function snapAge() { const at = Number(LS.get('snapAt')) || 0; return at ? Date.now() - at : Infinity; }

function unpair(msg) { LS.del('tok'); TOK = null; F.hidden = true; $('wait').hidden = true; $('pair').hidden = false; if (msg) { $('pm').textContent = msg; $('pm').className = 'msg e'; } }
$('go').onclick = async () => {
  const pin = $('pin').value.trim(), by = $('by').value; if (!pin) return;
  $('go').disabled = true; $('pm').className = 'msg'; $('pm').textContent = 'Linking…';
  try {
    const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'browser';
    const j = await post({ op: 'pair', by, pin, name });
    TOK = j.tok; BY = j.by; LS.set('tok', TOK); LS.set('by', BY); $('pin').value = '';
    $('pair').hidden = true; start();
  } catch (e) { $('pm').className = 'msg e'; $('pm').textContent = e.message; } finally { $('go').disabled = false; }
};

// the tracker page asks for data through google.script.run — inside the app those calls come here
OA.call = function (fn, args, ok, fail) {
  const arg = args[0] || {};
  if (fn === 'dashCode') return setTimeout(() => ok(OA.main), 0);
  if (fn === 'dashData') {
    const c = LS.get('snap');
    if (c) { setTimeout(() => ok(c), 0); if (snapAge() > STALE) fresh(true).catch(() => {}); else bar(''); }
    else fresh(false).then(ok).catch(fail);
    return;
  }
  if (fn === 'dashAction') {
    bar('Saving…');
    post({ op: 'action', tok: TOK, action: arg.action }).then(j => { LS.set('snapAt', '0'); bar(''); ok(j.result); }).catch(e => { bar('Not saved: ' + e.message, true); fail(e); });
    return;
  }
  setTimeout(() => fail(new Error('Not available in the app: ' + fn)), 0);
};
function fresh(kick) {
  if (inflight) return inflight;
  if (!navigator.onLine) { bar('📴 No signal — showing the copy from ' + ago(snapAge()), true); return Promise.reject(new Error('offline')); }
  bar('🔄 Updating… (showing the copy from ' + ago(snapAge()) + ')');
  inflight = post({ op: 'data', tok: TOK }).then(j => {
    LS.set('snap', j.data); LS.set('snapAt', String(Date.now())); bar('');
    if (kick) { try { const b = F.contentDocument && F.contentDocument.getElementById('refresh'); if (b) b.click(); } catch (e) {} }
    return j.data;
  }).catch(e => {
    if (/not linked/i.test(e.message)) unpair('This phone is not linked any more — enter the PIN again.');
    else bar('📴 Could not update (' + e.message + ') — showing the copy from ' + ago(snapAge()), true);
    throw e;
  }).finally(() => { inflight = null; });
  return inflight;
}
const SHIM = 'try{sessionStorage.setItem("dashpin","device")}catch(e){}' +
  'window.google={script:{run:(function mk(ok,fail){return new Proxy({},{get:function(t,p){if(p==="withSuccessHandler")return function(f){return mk(f,fail)};if(p==="withFailureHandler")return function(f){return mk(ok,f)};' +
  'return function(){parent.OA.call(p,[].slice.call(arguments),ok||function(){},fail||function(){})}}})})()}};';
function render(src) {
  const cut = src.indexOf('<!--MAINJS-->'); if (cut < 0) throw new Error('page');
  OA.main = src.slice(cut + 13);
  const head = src.slice(0, cut).replace('%%BY%%', BY).replace('<base target="_top">', '<base target="_blank">').replace(/<head[^>]*>/i, m => m + '<script>' + SHIM + '<\/script>');
  F.srcdoc = head + '<script>(function(){var s=document.createElement("script");s.textContent=parent.OA.main;document.body.appendChild(s);})();<\/script></body></html>';
  F.hidden = false; $('wait').hidden = true;
}
async function start() {
  const page = LS.get('page');
  if (page) { render(page); post({ op: 'page', tok: TOK }).then(j => { if (j.page && j.page !== page) LS.set('page', j.page); }).catch(() => {}); return; }   // a newer page is used from the next opening
  $('wait').textContent = '📊 Loading the tracker for the first time…';
  try { const j = await post({ op: 'page', tok: TOK }); LS.set('page', j.page); render(j.page); }
  catch (e) { if (/not linked/i.test(e.message)) unpair('Enter the owner PIN to link this phone.'); else $('wait').textContent = 'Could not load the tracker: ' + e.message + ' — check the signal and open again.'; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && TOK && LS.get('snap') && snapAge() > STALE) fresh(true).catch(() => {}); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (TOK) start(); else unpair();
