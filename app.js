/* Kulathamackal Farm — punch app for Tomy (v1, 28/10/2026).
   Opens from the phone with no loading. Every IN / OUT is saved on the phone first, with the time and GPS of the tap,
   and sent to the farm app by itself whenever there is signal. Nothing is lost if the signal drops. */
'use strict';
const EXEC = 'https://script.google.com/macros/s/AKfycbzvUFuUZ7MZuC6CDvaMf-Ej1-NJYm3dosqsHsZehHDyXxVO0IhPlNoBzt1-RaRdGzrmtQ/exec';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('fp_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fp_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const S = { token: LS.get('tok', ''), boot: LS.get('boot', null), q: LS.get('q', []), errs: LS.get('errs', []), done: LS.get('done', []), grp: LS.get('grp', null),
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
    const j = await call({ app: 'punch', token: S.token, sentAt: Date.now(), ops: ops.map(o => Object.assign({}, o, { label: undefined })), boot: true }, ops.some(o => o.photo) ? 120000 : 60000);
    if (!j.ok) { if (j.relink) { S.token = ''; LS.set('tok', ''); } throw new Error(j.error || 'server'); }
    (j.results || []).forEach(r => {
      const i = S.q.findIndex(o => o.uid === r.uid); if (i < 0) return;
      const o = S.q.splice(i, 1)[0];
      if (r.ok) S.done.push({ uid: o.uid, label: o.label, res: r.res, at: Date.now() });
      else { delete o.photoKeep; S.errs.push(Object.assign(o, { error: r.error })); }
    });
    if (j.boot) { S.boot = j.boot; LS.set('boot', j.boot); }
    S.net = 'ok'; S.lastOk = Date.now(); LS.set('lastOk', S.lastOk); save();
    if (S.q.length) setTimeout(() => flush(false), 500);
  } catch (e) {
    S.net = navigator.onLine === false ? 'offline' : 'weak';
  } finally { S.busy = false; paint(); }
}
setInterval(() => { if (S.q.length) flush(false); }, 20000);                       // keep trying while something waits
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
  const n = S.q.length, e = S.errs.length;
  $('st').innerHTML = (S.net === 'sending' ? '<span class="pill">🔄 അയയ്ക്കുന്നു / sending…</span>' : n ? `<span class="pill w">📴 ${n} ഫോണിൽ — സിഗ്നൽ വന്നാൽ അയയ്ക്കും / saved on phone</span>` : S.lastOk ? `<span class="pill">🟢 എല്ലാം അയച്ചു / all sent · ${hm(S.lastOk)}</span>` : '<span class="pill">…</span>') +
    (e ? `<span class="pill e">⚠️ ${e} ശ്രദ്ധിക്കുക / check</span>` : '') + (S.net === 'weak' || S.net === 'offline' ? '<span class="pill w">സിഗ്നൽ ഇല്ല / no signal</span>' : '');
  if (!S.token) return pairScreen();
  const B = S.boot;
  if (!B) { $('app').innerHTML = '<div class="card"><div class="h">ജോലിക്കാരുടെ പട്ടിക വരുന്നു… / Getting the worker list…</div><div class="note">ആദ്യത്തെ തവണ മാത്രം സിഗ്നൽ വേണം. / Needs signal the first time only.</div></div>'; return; }
  const grps = [{ id: '', name: 'Direct / നേരിട്ട്' }].concat(B.vendors).filter(g => B.workers.some(w => (w.vendorId || '') === g.id));
  if (S.grp === null || !grps.some(g => g.id === S.grp)) S.grp = grps.length > 1 ? grps[1].id : '';
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
    try { const j = await call({ app: 'punch', op: 'pair', code: c }, 40000); if (!j.ok) throw new Error(j.error); S.token = j.token; LS.set('tok', j.token); S.boot = j.boot; LS.set('boot', j.boot); S.lastOk = Date.now(); LS.set('lastOk', S.lastOk); paint(); }
    catch (e) { $('pmsg').innerHTML = '<span class="er">' + esc(e.message || 'No signal') + '</span>'; } };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
paint(); flush(true);
