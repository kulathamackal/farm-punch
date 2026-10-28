/* Kulathamackal Farm — punch app for Tomy (v1, 28/10/2026).
   Opens from the phone with no loading. Every IN / OUT is saved on the phone first, with the time and GPS of the tap,
   and sent to the farm app by itself whenever there is signal. Nothing is lost if the signal drops. */
'use strict';
const EXEC = 'https://script.google.com/macros/s/AKfycbzvUFuUZ7MZuC6CDvaMf-Ej1-NJYm3dosqsHsZehHDyXxVO0IhPlNoBzt1-RaRdGzrmtQ/exec';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('fp_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fp_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const S = { token: LS.get('tok', ''), boot: LS.get('boot', null), q: LS.get('q', []), errs: LS.get('errs', []), done: LS.get('done', []), grp: LS.get('grp', null), mode: 'urg', ttab: LS.get('ttab', 'today'), tomy: LS.get('tomy', null), tcode: LS.get('tcode', ''),
  net: 'idle', lastOk: LS.get('lastOk', 0), lastTry: 0, busy: false, pairSent: false };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const dkey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const save = () => { LS.set('q', S.q); LS.set('errs', S.errs); LS.set('done', S.done.slice(-30)); };

// ---------- talking to the farm app ----------
async function call(body, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || 90000);
  try {
    const r = await fetch(EXEC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ac.signal, redirect: 'follow', cache: 'no-store' });
    const j = await r.json(); return j;
  } finally { clearTimeout(t); }
}
async function flush(withBoot) {
  if (S.busy || !S.token) return;
  if (!S.q.length && !withBoot) return;
  S.busy = true; S.net = 'sending'; S.lastTry = Date.now(); paint();
  try {
    let n = 0, ops = []; for (const o of S.q) { if (ops.length >= 4 || (o.photo && n >= 1)) break; ops.push(o); if (o.photo) n++; }
    const pf = withBoot ? nextPrefetch() : '';
    const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), ops: ops.map(o => Object.assign({}, o, { label: undefined })), boot: true, tomy: !!withBoot, ch: S.tomy && S.tomy.ch || '', page: pf || undefined }, ops.some(o => o.photo) ? 120000 : 90000);
    if (!j.ok) { if (j.relink) { S.token = ''; LS.set('tok', ''); } throw new Error(j.error || 'server'); }
    (j.results || []).forEach(r => {
      const i = S.q.findIndex(o => o.uid === r.uid); if (i < 0) return;
      const o = S.q.splice(i, 1)[0];
      if (r.ok) S.done.push({ uid: o.uid, label: o.label, res: r.res, at: Date.now() });
      else { delete o.photoKeep; S.errs.push(Object.assign(o, { error: r.error })); }
    });
    if (j.boot) { S.boot = j.boot; LS.set('boot', j.boot); }
    if (j.page) storePage(j.page);
    if (j.tomy) { if (j.tomy.code) { S.tcode = j.tomy.code; LS.set('tcode', S.tcode); } S.tomy = { d: j.tomy.d, ch: j.tomy.ch, at: j.tomy.at }; LS.set('tomy', S.tomy); S.tomyNew = true; }
    S.net = 'ok'; S.lastOk = Date.now(); LS.set('lastOk', S.lastOk); save();
    if (S.q.length) setTimeout(() => flush(false), 500); else setTimeout(flushRuns, 300);
  } catch (e) {
    S.net = navigator.onLine === false ? 'offline' : 'weak';
  } finally { S.busy = false; paint(); }
}
setInterval(() => { if (S.q.length) flush(false); else if (S.rqN) flushRuns(); }, 20000);                       // keep trying while something waits
setInterval(() => { if (document.visibilityState === 'visible') flush(true); }, 180000);   // fresh list every 3 min
window.addEventListener('online', () => flush(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(true); });

// ---------- GPS (works without mobile data) ----------
function gps(waitMs) {
  return new Promise(res => {
    if (!navigator.geolocation) return res({ gerr: 'no GPS' });
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    setTimeout(() => fin({ gerr: 'GPS slow' }), waitMs || 12000);
    navigator.geolocation.getCurrentPosition(p => fin({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      e => fin({ gerr: e.code === 1 ? 'GPS not allowed' : 'GPS failed' }), { enableHighAccuracy: true, timeout: waitMs || 12000, maximumAge: 60000 });
  });
}
// ---------- photo, made small so it goes even on weak signal ----------
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const m = 640, k = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.6).split(',')[1]); };
    img.onerror = () => rej(new Error('photo could not be read')); img.src = url;
  });
}
function takePhoto() {
  return new Promise(res => { const c = $('cam'); c.value = ''; c.onchange = async () => { const f = c.files && c.files[0]; if (!f) return res(null); try { res(await shrink(f)); } catch (e) { res(null); } }; c.click(); });
}

// ---------- queue ----------
function queue(o) { o.uid = uid(); S.q.push(o); if (!save()) alert('Phone storage is full — send the waiting punches first'); paint(); flush(false); }
function stateOf(w) {
  const B = S.boot, today = dkey(Date.now()), sp = B && B.ds === today ? (B.punches || {})[w.id] : null;
  const st = { in: sp && sp.in || '', out: sp && sp.out || '', done: sp && sp.done, off: sp && sp.off, pin: null, pout: null };
  S.q.concat(S.errs.filter(e => !e.error)).forEach(o => { if (o.workerId !== w.id || dkey(o.at) !== today) return; if (o.type === 'in') st.pin = o; if (o.type === 'out') st.pout = o; });
  return st;
}

// ---------- screens ----------
function paint() {
  const n = S.q.length + (S.rqN || 0), e = S.errs.length + (S.rqE || 0);
  $('mode').innerHTML = S.token ? `<button data-m="urg" class="${S.mode === 'urg' ? 'on' : ''}">🚨 അടിയന്തരം${urgN() ? ' <span class="mb">' + urgN() + '</span>' : ''}<br>Urgent</button><button data-m="tomy" class="${S.mode === 'tomy' ? 'on' : ''}">📋 ജോലികൾ<br>Works</button><button data-m="punch" class="${S.mode === 'punch' ? 'on' : ''}">👷 ഹാജർ<br>IN · OUT</button><button data-m="more" class="${S.mode === 'more' || S.mode === 'page' ? 'on' : ''}">☰ എല്ലാം<br>All pages</button>` : '';
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.mode = b.dataset.m; LS.set('mode', S.mode); S.tomyNew = true; paint(); window.scrollTo(0, 0); });
  $('st').innerHTML = (S.net === 'sending' ? '<span class="pill">🔄 അയയ്ക്കുന്നു / sending…</span>' : n ? `<span class="pill w">📴 ${n} ഫോണിൽ — സിഗ്നൽ വന്നാൽ അയയ്ക്കും / saved on phone</span>` : S.lastOk ? `<span class="pill">🟢 എല്ലാം അയച്ചു / all sent · ${hm(S.lastOk)}</span>` : '<span class="pill">…</span>') +
    (e ? `<span class="pill e">⚠️ ${e} ശ്രദ്ധിക്കുക / check</span>` : '') + (S.net === 'weak' || S.net === 'offline' ? '<span class="pill w">സിഗ്നൽ ഇല്ല / no signal</span>' : '');
  if (!S.token) return pairScreen();
  if (S.mode === 'tomy' || S.mode === 'urg') return tomyScreen();
  if (S.mode === 'more') return moreScreen();
  if (S.mode === 'page') return pageScreen();
  const B = S.boot;
  if (!B) { $('app').innerHTML = '<div class="card"><div class="h">ജോലിക്കാരുടെ പട്ടിക വരുന്നു… / Getting the worker list…</div><div class="note">ആദ്യത്തെ തവണ മാത്രം സിഗ്നൽ വേണം. / Needs signal the first time only.</div></div>'; return; }
  const grps = [{ id: '', name: 'Direct / നേരിട്ട്' }].concat(B.vendors).filter(g => B.workers.some(w => (w.vendorId || '') === g.id));
  if (S.grp === null || !grps.some(g => g.id === S.grp)) S.grp = (grps.find(g => g.id) || grps[0] || { id: '' }).id;
  const today = dkey(Date.now()), stale = B.ds !== today;
  let h = `<div class="card"><div class="h">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }))}</div>
    <div class="note">${stale ? '⚠️ പട്ടിക ' + esc(B.label) + ' ലേത് — സിഗ്നൽ വന്നാൽ പുതുക്കും. / List is from ' + esc(B.label) + '; it refreshes when there is signal.' : 'പട്ടിക പുതുക്കിയത് / list updated ' + hm(B.at)}</div>
    <div class="seg">${grps.map(g => `<button data-g="${esc(g.id)}" class="${g.id === S.grp ? 'on' : ''}">${esc(g.name)}</button>`).join('')}</div>`;
  B.workers.filter(w => (w.vendorId || '') === S.grp).forEach(w => {
    const s = stateOf(w); let line, act = '';
    if (s.out || s.pout) line = `✅ IN ${s.in || hm(s.pin.at)} · OUT ${s.out || hm(s.pout.at)}${s.pout && !s.out ? ' ⏳' : ''}${s.done ? ' · ദിവസം ഉറപ്പിച്ചു' : ''}`;
    else if (s.in || s.pin) { line = `🟢 IN ${s.in || hm(s.pin.at)}${s.pin && !s.in ? ' ⏳ ഫോണിൽ / on phone' : ''}`; act = `<button class="btn out" data-out="${esc(w.id)}">OUT</button>`; }
    else { line = 'ഇതുവരെ വന്നിട്ടില്ല / not in yet'; act = `<button class="btn" data-in="${esc(w.id)}">IN</button>`; }
    h += `<div class="w"><div class="n"><b>${esc(w.name)}</b><span>${line}${w.pt !== 'smart' ? ' · 📷 ഫോട്ടോ IN' : ''}</span></div>${act}</div>`;
  });
  h += '</div>';
  if (S.q.length || S.errs.length) {
    h += `<div class="card"><div class="h">📴 ഫോണിൽ സൂക്ഷിച്ചത് / Saved on the phone</div><div class="note">സിഗ്നൽ കിട്ടുമ്പോൾ തനിയെ അയയ്ക്കും — ആപ്പ് അടച്ചാലും നഷ്ടപ്പെടില്ല; അടുത്ത തവണ തുറക്കുമ്പോൾ അയയ്ക്കും. / Sent by itself when there is signal; kept even if the app is closed.</div>`;
    S.q.forEach(o => { h += `<div class="q"><span>⏳ ${esc(o.label)} · ${hm(o.at)}</span></div>`; });
    S.errs.forEach((o, i) => { h += `<div class="q"><span class="er">⚠️ ${esc(o.label)} · ${hm(o.at)} — ${esc(o.error)}</span>${o.type === 'in' ? `<button data-rph="${i}">📷 Photo IN</button>` : `<button data-rtry="${i}">↻</button>`}<button data-rdel="${i}">✖</button></div>`; });
    h += `<button class="btn full" id="sendNow">↻ ഇപ്പോൾ അയയ്ക്കുക / Send now</button></div>`;
  }
  const dn = S.done.filter(d => dkey(d.at) === today).slice(-6).reverse();
  if (dn.length) h += `<div class="card"><div class="h">✔ അയച്ചത് / Sent today</div>${dn.map(d => `<div class="q"><span class="ok">${esc(d.label)} — ${esc(d.res)}</span></div>`).join('')}</div>`;
  h += `<div class="card note">ദിവസം ഉറപ്പിക്കാൻ (Approve day) / To confirm the day: <a href="${esc(B.casualUrl)}" target="_blank" rel="noopener">Outside workers page ↗</a> (സിഗ്നൽ വേണം / needs signal).<br>${S.lastOk ? 'അവസാനം അയച്ചത് / last sent ' + hm(S.lastOk) : ''}</div>`;
  $('app').innerHTML = h;
  document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { S.grp = b.dataset.g; LS.set('grp', S.grp); paint(); });
  document.querySelectorAll('[data-in]').forEach(b => b.onclick = () => inFlow(B.workers.find(w => w.id === b.dataset.in)));
  document.querySelectorAll('[data-out]').forEach(b => b.onclick = () => outFlow(B.workers.find(w => w.id === b.dataset.out)));
  document.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { if (confirm('ഇത് ഒഴിവാക്കട്ടെ? / Remove this?')) { S.errs.splice(+b.dataset.rdel, 1); save(); paint(); } });
  document.querySelectorAll('[data-rtry]').forEach(b => b.onclick = () => { const o = S.errs.splice(+b.dataset.rtry, 1)[0]; delete o.error; S.q.push(o); save(); flush(false); });
  document.querySelectorAll('[data-rph]').forEach(b => b.onclick = async () => { const i = +b.dataset.rph, o = S.errs[i]; const ph = await takePhoto(); if (!ph) return;
    S.errs.splice(i, 1); delete o.error; delete o.code; o.photo = { b64: ph }; o.label = o.label.replace(/ \(code\)$/, '') + ' (photo)'; S.q.push(o); save(); flush(false); });
  const sn = $('sendNow'); if (sn) sn.onclick = () => flush(true);
}
// ---------- 📌 Tomy's whole page (v99): the farm app's own page, kept on the phone ----------
function tomyScreen() {
  if (!S.tomy || !S.tcode) { $('app').innerHTML = '<div class="card"><div class="h">ജോലിപ്പട്ടിക വരുന്നു… / Getting your list…</div><div class="note">ആദ്യത്തെ തവണ മാത്രം സിഗ്നൽ വേണം. / Needs signal the first time only.</div></div>'; return; }
  if (!S.tomyNew && $('all')) { const u = $('tupd'); if (u) u.textContent = tomyUpd(); return; }   // keep the open tab as it is; redraw only when new data came
  S.tomyNew = false;
  $('app').innerHTML = `<div class="note" id="tupd" style="margin:0 2px 8px">${tomyUpd()}</div><div id="tabs" style="display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 10px"></div><div id="all"></div>`;
  window.D = JSON.parse(JSON.stringify(S.tomy.d)); window.D.tab = S.mode === 'urg' ? 'urg' : (S.ttab || 'today');
  try { sessionStorage.removeItem('tomyTab'); } catch (e) {}
  try { (0, eval)(S.tcode); } catch (e) { $('all').innerHTML = '<div class="card er">Could not show the list: ' + esc(e.message) + '</div>'; }
}
document.addEventListener('click', ev => {   // inside Tomy's page: IN / OUT links stay in the app; 🔄 refresh fetches a new list
  const a = ev.target.closest && ev.target.closest('#all a[href*="script.google.com/macros"], #more a[href*="script.google.com/macros"]');
  if (a) { ev.preventDefault(); appNav(a.href); return; }
  const r = ev.target.closest && ev.target.closest('#all button[onclick*="reload"]');
  if (r) { ev.preventDefault(); ev.stopImmediatePropagation(); flush(true); }
}, true);
// 🚨 Urgent as its own button (Kurian 28/10/2026): the same count as the Urgent tab on Tomy's page
function urgN() { const D = S.tomy && S.tomy.d; if (!D || !D.items) return 0; const I = D.items;
  return I.filter(x => x.g === 'late').length + I.filter(x => x.g === 'today' && x.cat === 'fert' && x.to === D.ds).length + I.filter(x => x.cat === 'stock' && x.g !== 'late').length +
    I.filter(x => x.cat === 'book' && x.g !== 'late').length + I.filter(x => x.cat === 'gauge').length + ((D.buyNow || []).length ? 1 : 0); }
document.addEventListener('click', ev => {   // a tab chip inside Tomy's page: keep the top buttons in step
  const b = ev.target.closest && ev.target.closest('#tabs button[data-t]'); if (!b) return;
  setTimeout(() => { const t = b.getAttribute('data-t'); if (t === 'urg') S.mode = 'urg'; else { S.mode = 'tomy'; S.ttab = t; LS.set('ttab', t); } paintTop(); }, 0);
}, true);
function paintTop() { const m = $('mode'); if (!m) return; m.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === S.mode || (x.dataset.m === 'more' && S.mode === 'page'))); }
function tomyUpd() { const t = S.tomy && S.tomy.at; if (!t) return ''; const m = Math.round((Date.now() - t) / 60000), old = dkey(t) !== dkey(Date.now());
  return (old ? '⚠️ ' : '') + 'പട്ടിക / list ' + (old ? new Date(t).toLocaleDateString('en-GB') + ' ' : '') + hm(t) + (m > 15 ? ' — സിഗ്നൽ വന്നാൽ പുതുക്കും / refreshes when there is signal' : ''); }
function modal(html) { $('mbox').innerHTML = html; $('modal').style.display = html ? 'flex' : 'none'; }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') modal(''); });

async function inFlow(w) {
  const at = Date.now(), gp = gps(15000);   // the time of the tap is the IN time
  const codeOk = w.pt === 'smart';
  modal(`<div class="h" style="font-size:18px">IN — ${esc(w.name)} · ${hm(at)}</div>
    <div class="note" style="margin:6px 0 10px">${codeOk ? 'സിഗ്നൽ ഉണ്ടെങ്കിൽ കോഡ്; ഇല്ലെങ്കിൽ ഫോട്ടോ. / Code if there is signal, else his photo.' : 'ഈ ജോലിക്കാരന് ഫോട്ടോ മതി. / This worker is punched in by photo.'}</div>
    ${codeOk ? `<button class="btn full" data-c="worker">📲 ${esc(w.name)}ന്റെ WhatsApp-ലേക്ക് കോഡ് / Code to his WhatsApp</button>
    ${w.vendorId && w.vPhone ? `<button class="btn full gray" data-c="vendor">📲 കോൺട്രാക്ടർക്ക് കോഡ് / Code to the contractor</button>` : ''}
    <button class="btn full gray" data-c="owner">📲 കുര്യൻ / സന്ധ്യക്ക് കോഡ് / Code to Kurian & Sandhya</button>
    <div id="cmsg" class="note" style="margin-top:8px"></div>
    <div id="cbox" style="display:none;margin-top:8px"><input id="code" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="btn full" id="cin">✔ കോഡ് ചേർത്ത് IN / IN with code</button></div>` : ''}
    <button class="btn full amb" id="pin">📷 ഫോട്ടോ എടുത്ത് IN / IN with his photo</button>
    <button class="btn full gray" id="cx">റദ്ദാക്കുക / Cancel</button>`);
  $('cx').onclick = () => modal('');
  $('pin').onclick = async () => { const ph = await takePhoto(); if (!ph) return; const g = await gp; modal(''); queue(Object.assign({ type: 'in', workerId: w.id, at, photo: { b64: ph }, label: 'IN ' + w.name + ' (photo)' }, g)); };
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    $('cmsg').textContent = 'കോഡ് അയയ്ക്കുന്നു… / sending the code…';
    try {
      const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), ops: [{ uid: uid(), type: 'code', workerId: w.id, to: b.dataset.c }] }, 30000);
      const r = (j.results || [])[0] || {}; if (!j.ok || !r.ok) throw new Error((r && r.error) || j.error || 'failed');
      $('cmsg').innerHTML = '<span class="ok">✔ കോഡ് അയച്ചു / code sent' + (r.res && r.res.to ? ' → ' + esc(r.res.to) : '') + '</span>'; $('cbox').style.display = 'block'; $('code').focus();
    } catch (e) { $('cmsg').innerHTML = '<span class="er">' + (e.name === 'AbortError' || /fetch|network/i.test(e.message) ? 'സിഗ്നൽ ഇല്ല — ഫോട്ടോ എടുക്കുക / No signal — take his photo' : esc(e.message)) + '</span>'; }
  });
  if (codeOk) $('cin').onclick = async () => { const c = $('code').value.replace(/\D/g, ''); if (c.length !== 6) return; const g = await gp; modal(''); queue(Object.assign({ type: 'in', workerId: w.id, at, code: c, label: 'IN ' + w.name + ' (code)' }, g)); };
}
async function outFlow(w) {
  const at = Date.now();
  modal(`<div class="h" style="font-size:18px">OUT — ${esc(w.name)} · ${hm(at)}</div><div class="note" style="margin:6px 0 10px">ഇപ്പോൾ പോകുന്നു? / Leaving now?</div>
    <button class="btn full out" id="ok">✔ OUT ${hm(at)}</button><button class="btn full gray" id="cx">റദ്ദാക്കുക / Cancel</button>`);
  $('cx').onclick = () => modal('');
  $('ok').onclick = async () => { $('ok').disabled = true; $('ok').textContent = 'GPS…'; const g = await gps(8000); modal(''); queue(Object.assign({ type: 'out', workerId: w.id, at, label: 'OUT ' + w.name }, g)); };
}
function pairScreen() {
  $('app').innerHTML = `<div class="card"><div class="h">🔗 ഈ ഫോൺ ബന്ധിപ്പിക്കുക / Link this phone (once)</div>
    <div class="note" style="margin:6px 0 10px">കുര്യനും സന്ധ്യക്കും WhatsApp-ൽ ഒരു കോഡ് വരും. അത് ഇവിടെ ചേർക്കുക. / A code goes to Kurian and Sandhya on WhatsApp — enter it here. Needs signal once.</div>
    <button class="btn full" id="preq">📲 കോഡ് ചോദിക്കുക / Ask for the code</button><div id="pmsg" class="note" style="margin-top:8px"></div>
    <input id="pcode" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="margin-top:10px"><button class="btn full" id="pgo">🔗 ബന്ധിപ്പിക്കുക / Link</button></div>`;
  $('preq').onclick = async () => { $('pmsg').textContent = '…'; try { const j = await call({ app: 'punch', op: 'pairReq', name: 'Tomy' }, 40000); $('pmsg').innerHTML = j.ok ? '<span class="ok">✔ കോഡ് അയച്ചു — കുര്യനോട് / സന്ധ്യയോട് ചോദിക്കുക / Code sent to Kurian & Sandhya</span>' : '<span class="er">' + esc(j.error) + '</span>'; } catch (e) { $('pmsg').innerHTML = '<span class="er">സിഗ്നൽ ഇല്ല / No signal — try where there is signal</span>'; } };
  $('pgo').onclick = async () => { const c = $('pcode').value.replace(/\D/g, ''); if (c.length !== 6) return; $('pmsg').textContent = '…';
    try { const j = await call({ app: 'punch', op: 'pair', code: c }, 40000); if (!j.ok) throw new Error(j.error); S.token = j.token; LS.set('tok', j.token); S.boot = j.boot; LS.set('boot', j.boot); S.lastOk = Date.now(); LS.set('lastOk', S.lastOk); paint(); flush(true); }
    catch (e) { $('pmsg').innerHTML = '<span class="er">' + esc(e.message || 'No signal') + '</span>'; } };
}

// ======================= v3: every page of Tomy's inside the app =======================
// Each farm page (approve day, Now, fertiliser, irrigation, maintenance, photos, expenses, issues, new worker, contractor) is kept on the
// phone and opened here at once. The page's saves are kept on the phone first (IndexedDB, photos too) and sent by themselves when there is
// signal; look-ups and IN-codes need signal. Owner-only actions are not possible from Tomy's phone.
const PAGES = [['casual', '👷 ദിവസം ഉറപ്പിക്കൽ / Approve day'], ['now', '📍 ഇപ്പോൾ ചെയ്യുന്ന ജോലി / Now'], ['fert', '🌱 വളം / Fertiliser'], ['irrig', '💧 നന · മഴമാപിനി / Irrigation'],
  ['upkeep', '🔧 പരിപാലനം / Maintenance'], ['photos', '📷 ഫീൽഡ് ഫോട്ടോ / Field photos'], ['expense', '🧾 ചെലവ് · ബില്ല് / Expenses'], ['issue', '🩺 ചെടി പ്രശ്നം / Field issues'],
  ['register', '🆔 പുതിയ ജോലിക്കാരൻ / New worker'], ['vendor', '🏢 കോൺട്രാക്ടർ / Contractor']];
const PNAME = {}; PAGES.forEach(x => PNAME[x[0]] = x[1]);
const READ = /^(get[A-Z]|photoThumbs$|readBill$)/;
const LIVE = { sendPunchCode: 1, verifyPunchIn: 1, punchInPhoto: 1, punchOutCasual: 1, requestFixCode: 1, fixOutWithCode: 1, requestTimesCode: 1, fixTimesWithCode: 1 };
const DENY = { ownerFixOut: 1, ownerFixTimes: 1, decideIssue: 1, decideExpense: 1, repayTomyExpenses: 1 };
const FNL = { saveFert: 'വളം ചെയ്തത്', saveFertCount: 'സ്റ്റോക്ക് എണ്ണം', saveStockMove: 'സ്റ്റോക്ക് മാറ്റം', saveUpkeep: 'പരിപാലനം ചെയ്തു', bookUpkeep: 'ജോലിക്കാരെ ഏർപ്പാടാക്കി', savePhoto: 'ഫോട്ടോ',
  saveExpense: 'ചെലവ്', saveIssue: 'ചെടി പ്രശ്നം', saveIssueFollowup: 'പുതിയ ഫോട്ടോ', issueAutoNow: 'Claude പരിശോധന', saveIrrig: 'നന', saveRainGauge: 'മഴ mm', saveFlowerBuds: 'പൂമൊട്ട്',
  setWorkNow: 'ജോലി നൽകി', approvePunchDay: 'ദിവസം ഉറപ്പിച്ചു', addMissedDay: 'വിട്ടുപോയ ദിവസം', tomyFixTimes: 'സമയം തിരുത്തി', saveRegistration: 'പുതിയ ജോലിക്കാരൻ', saveVendor: 'കോൺട്രാക്ടർ' };
const IDB = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('farm', 1); r.onupgradeneeded = () => r.result.createObjectStore('runq', { keyPath: 'uid' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async tx(mode, f) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('runq', mode), r = f(t.objectStore('runq')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
  all() { return this.tx('readonly', s => s.getAll()); }, put(o) { return this.tx('readwrite', s => s.put(o)); }, del(k) { return this.tx('readwrite', s => s.delete(k)); }
};
async function countRq() { try { const L = await IDB.all(); S.rqN = L.filter(x => !x.err).length; S.rqE = L.filter(x => x.err).length; S.rqL = L.sort((a, b) => a.at - b.at); } catch (e) {} paint(); }
const netErr = e => e && (e.name === 'AbortError' || /fetch|network|Failed|timeout/i.test(String(e.message || e)));
function toast(t) { let d = $('toast'); if (!d) { d = document.createElement('div'); d.id = 'toast'; d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;background:#263238;color:#fff;padding:12px 14px;border-radius:10px;font-size:14px;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,.3)'; document.body.appendChild(d); }
  d.textContent = t; d.style.display = 'block'; clearTimeout(d._t); d._t = setTimeout(() => d.style.display = 'none', 4500); }
async function shrinkB64(b64) { return new Promise(res => { const img = new Image(); img.onload = () => { const m = 1280, k = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7).split(',')[1]); }; img.onerror = () => res(b64); img.src = 'data:image/jpeg;base64,' + b64; }); }
async function slimPhotos(x, depth) {   // big photos made smaller before they wait on the phone and travel on weak signal
  if (!x || typeof x !== 'object' || (depth || 0) > 3) return x;
  for (const k of Object.keys(x)) { const v = x[k];
    if (typeof v === 'string' && k === 'b64' && v.length > 350000 && !/pdf/i.test(x.mime || '')) x[k] = await shrinkB64(v);
    else if (v && typeof v === 'object') await slimPhotos(v, (depth || 0) + 1); }
  return x;
}
async function sendRun(item, ms) {   // {ok, val} sent · {err} refused by the farm app · null = no signal / too slow (stays on the phone)
  try {
    const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), ops: [{ uid: item.uid, type: 'run', fn: item.fn, arg: item.arg }] }, ms);
    if (!j.ok) { if (j.relink) { S.token = ''; LS.set('tok', ''); } return null; }
    const r = (j.results || [])[0] || {};
    if (r.ok) { await IDB.del(item.uid); S.done.push({ uid: item.uid, label: item.label, res: '✔', at: Date.now() }); save(); LS.set('pgst_' + item.page, 1); S.tomyNew = true; countRq(); return { ok: true, val: r.res && r.res.r }; }
    await IDB.put(Object.assign(item, { err: r.error || 'error' })); countRq(); return { err: r.error || 'error' };
  } catch (e) { return null; }
}
let runBusy = false;
async function flushRuns() {
  if (runBusy || !S.token || S.busy) return; runBusy = true;
  try { const L = (await IDB.all()).filter(x => !x.err).sort((a, b) => a.at - b.at);
    for (const it of L) { S.net = 'sending'; paint(); const r = await sendRun(it, it.arg && JSON.stringify(it.arg).length > 200000 ? 180000 : 90000); if (!r) { S.net = 'weak'; break; } S.net = 'ok'; S.lastOk = Date.now(); LS.set('lastOk', S.lastOk); }
  } catch (e) {} finally { runBusy = false; countRq(); }
}
async function appRun(fn, arg, ok, fail, win, pg) {   // google.script.run from a page inside the app
  const F = m => { try { fail && fail({ message: m }); } catch (e) {} };
  if (DENY[fn]) return F('ഉടമകൾക്ക് മാത്രം / Owners only');
  if (READ.test(fn) || LIVE[fn]) {
    try { const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), ops: [{ uid: uid(), type: 'run', fn, arg }] }, READ.test(fn) ? 45000 : 60000);
      const r = (j.results || [])[0]; if (!j.ok || !r || !r.ok) throw new Error((r && r.error) || j.error || 'failed'); ok && ok(r.res && r.res.r); }
    catch (e) { F(netErr(e) ? (LIVE[fn] ? 'സിഗ്നൽ ഇല്ല — IN / OUT മുകളിലെ 👷 IN · OUT ടാബിൽ ചെയ്യുക (സിഗ്നൽ വേണ്ട) / No signal — use the 👷 IN · OUT tab above' : 'സിഗ്നൽ ഇല്ല — സിഗ്നൽ ഉള്ളപ്പോൾ നോക്കുക / No signal — try when there is signal') : e.message); }
    return;
  }
  let a2; try { a2 = await slimPhotos(JSON.parse(JSON.stringify(arg == null ? {} : arg))); } catch (e) { a2 = arg; }
  const item = { uid: uid(), fn, arg: a2, at: Date.now(), page: pg, label: (PNAME[pg] || pg).split(' / ')[0] + ' — ' + (FNL[fn] || fn) };
  try { await IDB.put(item); } catch (e) { return F('ഫോണിൽ സൂക്ഷിക്കാൻ കഴിഞ്ഞില്ല / Could not keep it on the phone: ' + e.message); }
  countRq();
  const res = await sendRun(item, 25000);
  if (res && res.ok) { try { ok && ok(res.val !== undefined ? res.val : win.D); } catch (e) {} toast('✔ സേവ് ചെയ്തു / Saved'); }
  else if (res && res.err) F(res.err);
  else { try { ok && ok(win.D); } catch (e) {} toast('📴 ഫോണിൽ സൂക്ഷിച്ചു — സിഗ്നൽ വന്നാൽ തനിയെ അയയ്ക്കും / Saved on the phone — sent when there is signal'); }
}
function appNav(href) {
  let u; try { u = new URL(href); } catch (e) { return; }
  const p = u.searchParams.get('p') || '', ds = u.searchParams.get('ds') || '';
  if (p === 'casual' && !ds && (S.mode === 'tomy' || S.mode === 'urg')) { S.mode = 'punch'; }
  else if (PNAME[p]) { S.mode = 'page'; S.page = { p, ds }; }
  else if (p === 'today' || p === 'tomy' || !p) { S.mode = 'tomy'; S.tomyNew = true; }
  else { window.open(href, '_blank'); return; }
  LS.set('mode', S.mode === 'page' ? 'more' : S.mode); paint(); window.scrollTo(0, 0);
}
const pgKey = P => 'pg_' + P.p + (P.ds ? '_' + P.ds : '');
function storePage(pg) { if (!pg || !pg.p) return; LS.set('pg_' + pg.p + (pg.ds ? '_' + pg.ds : ''), { html: pg.html, title: pg.title, at: pg.at }); LS.set('pgst_' + pg.p, 0); }
function nextPrefetch() {   // keeps a fresh copy of every page on the phone, one page per refresh
  const now = Date.now(); for (const [p] of PAGES) { const c = LS.get('pg_' + p, null); if (!c || LS.get('pgst_' + p, 0) || now - c.at > 3600000) return p; } return '';
}
function moreScreen() {
  const L = S.rqL || [];
  let h = '<div class="card" id="more"><div class="h">☰ എല്ലാ പേജുകളും / All pages</div><div class="note" style="margin:4px 0 8px">സിഗ്നൽ ഇല്ലെങ്കിലും തുറക്കാം, സേവ് ചെയ്യാം — സിഗ്നൽ വരുമ്പോൾ തനിയെ അയയ്ക്കും. / Open and save even with no signal — sent when there is signal.</div>' +
    PAGES.map(([p, nm]) => { const c = LS.get('pg_' + p, null); return `<button class="btn full" style="text-align:left;background:#fff;color:var(--ink);border:1px solid var(--line)" data-pg="${p}">${esc(nm)}<span class="note" style="float:right">${c ? hm(c.at) : '—'}</span></button>`; }).join('') + '</div>';
  if (L.length) h += '<div class="card"><div class="h">📴 ഫോണിൽ സൂക്ഷിച്ചത് / Saved on the phone</div>' + L.map(x => `<div class="q"><span class="${x.err ? 'er' : ''}">${x.err ? '⚠️' : '⏳'} ${esc(x.label)} · ${hm(x.at)}${x.err ? ' — ' + esc(x.err) : ''}</span>${x.err ? `<button data-rr="${esc(x.uid)}">↻</button><button data-rx="${esc(x.uid)}">✖</button>` : ''}</div>`).join('') + '<button class="btn full" id="sendRuns">↻ ഇപ്പോൾ അയയ്ക്കുക / Send now</button></div>';
  $('app').innerHTML = h;
  document.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { S.mode = 'page'; S.page = { p: b.dataset.pg, ds: '' }; paint(); window.scrollTo(0, 0); });
  document.querySelectorAll('[data-rx]').forEach(b => b.onclick = async () => { if (confirm('ഇത് ഒഴിവാക്കട്ടെ? / Remove this?')) { await IDB.del(b.dataset.rx); countRq(); } });
  document.querySelectorAll('[data-rr]').forEach(b => b.onclick = async () => { const it = (S.rqL || []).find(x => x.uid === b.dataset.rr); if (it) { delete it.err; await IDB.put(it); countRq(); flushRuns(); } });
  const sr = $('sendRuns'); if (sr) sr.onclick = () => { flush(true); flushRuns(); };
}
function pageScreen() {
  const P = S.page || { p: 'fert', ds: '' }, c = LS.get(pgKey(P), null) || (P.ds ? null : LS.get('pg_' + P.p, null));
  if (!$('pf') || $('app').dataset.pg !== pgKey(P)) {
    $('app').dataset.pg = pgKey(P);
    $('app').innerHTML = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button class="btn gray" id="pback" style="min-width:0;padding:9px 12px">←</button><div style="flex:1"><b>${esc(PNAME[P.p] || P.p)}</b><div class="note" id="pinfo"></div></div><button class="btn gray" id="prel" style="min-width:0;padding:9px 12px">🔄</button></div>` +
      (c ? '<iframe id="pf" style="width:100%;border:0;border-radius:12px;background:#eef2f6;height:calc(100vh - 175px)"></iframe>' : '<div class="card" id="pf0"><div class="h">പേജ് വരുന്നു… / Getting the page…</div><div class="note">ആദ്യത്തെ തവണ മാത്രം സിഗ്നൽ വേണം. / Needs signal the first time only.</div></div>');
    $('pback').onclick = () => { S.mode = 'more'; paint(); };
    $('prel').onclick = () => loadPage(P, true);
    if (c) mountFrame(c, P.p);
    if (!c || LS.get('pgst_' + P.p, 0) || Date.now() - c.at > 300000) loadPage(P, !c);
  }
  const i = $('pinfo'), cc = LS.get(pgKey(P), null); if (i) i.textContent = cc ? 'പേജ് / page ' + hm(cc.at) : '';
}
function mountFrame(c, pg) {
  const shim = '<script>(function(){var P=parent,pg=' + JSON.stringify(pg) + ';function mk(s,f){return new Proxy({},{get:function(t,k){if(k==="withSuccessHandler")return function(h){return mk(h,f)};if(k==="withFailureHandler")return function(h){return mk(s,h)};if(k==="withUserObject")return function(){return mk(s,f)};return function(a){P.appRun(k,a,s,f,window,pg)}}})}' +
    'window.google={script:{run:mk(null,null),host:{close:function(){}}}};document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(h.indexOf("script.google.com/macros")>=0){e.preventDefault();P.appNav(a.href);}},true);' +
    'document.addEventListener("input",function(){P.S.pdirty=true},true);})();<\/script>';
  const f = $('pf'); if (!f) return; S.pdirty = false;
  f.setAttribute('allow', 'geolocation; camera');
  f.srcdoc = String(c.html).replace('<head>', '<head>' + shim);
}
async function loadPage(P, force) {
  try { const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), page: P.p, ds: P.ds || undefined }, 60000);
    if (!j.ok || !j.page) throw new Error(j.error || 'no page'); storePage(j.page);
    if (S.mode === 'page' && S.page && pgKey(S.page) === pgKey(P)) {
      if (!$('pf') || force || !S.pdirty) { $('app').dataset.pg = ''; pageScreen(); }
      else toast('🔄 പുതിയ വിവരം ഉണ്ട് — 🔄 അമർത്തുക / Newer data — tap 🔄');
    }
  } catch (e) { if (force) toast('സിഗ്നൽ ഇല്ല — ഫോണിലെ പേജ് കാണിക്കുന്നു / No signal — showing the copy on the phone'); }
}
window.S = S;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
countRq(); paint(); flush(true);
