/* ============ FIREBASE CONFIG (ISI DI SINI) ============ */
const firebaseConfig = {
  apiKey: "AIzaSyCbS4BwZn-znx3c9VZk3WQFP_I1nys2iHY",
  authDomain: "k8s-monitoring-ito.firebaseapp.com",
  databaseURL: "https://k8s-monitoring-ito-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "k8s-monitoring-ito",
  storageBucket: "k8s-monitoring-ito.firebasestorage.app",
  messagingSenderId: "761218011895",
  appId: "1:761218011895:web:7133716ddc39eee64379f2",
  measurementId: "G-35KDQZGGD6"
};

/* ============ KONSTANTA & STATE ============ */
const ENV = "Prod-BTN-Syariah-Kubernetes", NS = "preprod-sharia-btn";
const CMD = `echo "=== WORKER NODES ===" && kubectl get nodes && echo "" && kubectl top nodes && echo "" && echo "=== PODS STATUS ===" && kubectl get pod -n preprod-sharia-btn -o wide && echo "" && kubectl top pod -n preprod-sharia-btn && echo "" && echo "=== DEPLOYMENTS STATUS ===" && kubectl get deployment -n preprod-sharia-btn`;
const SL = { CRITICAL: '🔴 CRITICAL', WARNING: '🟡 WARNING', HEALTHY: '🟢 HEALTHY' };
const COL = ['#046748', '#2563EB', '#F97316', '#7C3AED', '#DC2626', '#0D9488', '#DB2777', '#CA8A04', '#475569', '#65A30D'];
let DB = {}, cur = null, ref = null, charts = [], tabNow = 't1', cfm = null, lastMon = '';

/* ============ HELPER ============ */
const $ = id => document.getElementById(id);
const A = x => x ? Object.values(x) : [];
const R = v => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n); };   // Math.round standar
const P = v => v == null ? '' : v + '%';   // null/kosong => blank; 0 => "0%"
const fd = d => d.slice(0, 10).split('-').reverse().join('/');   // aman untuk tanggal maupun recordId
const REC = 'k8s_monitoring/records/', DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function sanitizeKey(s) { return String(s || '').replace(/[\.#$\[\]\-]/g, '_'); }   // karakter terlarang & strip -> "_"
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dates = () => Object.keys(DB).sort();
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const bd = s => `<span class="bdg ${s}">${SL[s]}</span>`;
const pb = s => !s ? '' : `<span class="bdg ${/^(running|completed|succeeded)$/i.test(s) ? 'HEALTHY' : /pending|creating|init|terminating/i.test(s) ? 'WARNING' : 'CRITICAL'}">${esc(s)}</span>`;
const rm = w => { const v = [w.cpu, w.mem, w.disk].map(x => x || 0); return v.some(x => x > 90) ? 'CRITICAL' : v.some(x => x >= 70) ? 'WARNING' : 'HEALTHY'; };
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
function toast(m, t = 'success') { const d = document.createElement('div'); d.className = 'toast-lite ' + t; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); }
function cp(txt) {
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Tersalin ke clipboard')).catch(() => {
    const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Tersalin ke clipboard');
  });
}
function ask(msg, fn) { $('cmMsg').textContent = msg; cfm = fn; bootstrap.Modal.getOrCreateInstance($('mCf')).show(); }
function setCS(on) { $('cs').className = 'cs ' + (on ? 'on' : 'off'); $('cs').textContent = on ? '🟢 Cloud Connected' : '🔴 Offline'; }

/* ============ FIREBASE REALTIME SYNC + AUTHENTICATION ============ */
let authUser = null, fbOk = false;
const LOGIN_TXT = '<i class="fa-solid fa-right-to-bracket me-2"></i>Masuk / Login';
const showLogin = on => { $('loginOverlay').classList.toggle('d-none', !on); document.body.classList.toggle('locked', on); };
const loginMsg = m => { const e = $('loginErr'); e.textContent = m || ''; e.classList.toggle('d-none', !m); };
function loginBusy(on) { const b = $('loginBtn'); b.disabled = on; b.innerHTML = on ? '<span class="spinner-border spinner-border-sm me-2"></span>Memproses...' : LOGIN_TXT; }
function authErr(c = '') {   // pesan generik agar tidak membocorkan apakah email terdaftar
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Email atau password salah.';
  if (/invalid-email/.test(c)) return 'Format email tidak valid.';
  if (/user-disabled/.test(c)) return 'Akun ini dinonaktifkan. Hubungi admin.';
  if (/too-many-requests/.test(c)) return 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.';
  if (/network/.test(c)) return 'Koneksi bermasalah. Periksa jaringan Anda.';
  if (/operation-not-allowed/.test(c)) return 'Login Email/Password belum diaktifkan di Firebase Console.';
  if (/api-key/.test(c)) return 'API Key Firebase tidak valid. Periksa firebaseConfig di app.js.';
  return 'Login gagal (' + c + '). Silakan coba lagi.';
}
function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    ref = db.ref('k8s_monitoring/records');
    db.ref('.info/connected').on('value', s => setCS(s.val() === true));
    fbOk = true;
    firebase.auth().onAuthStateChanged(user => user ? onLogin(user) : onLogout());
  } catch (e) {
    console.error('Firebase Init Error:', e); setCS(false);
    $('loginBtn').disabled = true; $('loginBtn').innerHTML = LOGIN_TXT;
    loginMsg('Firebase belum dikonfigurasi (cek firebaseConfig di app.js).');
  }
}
function startSync() {   // listener database hanya aktif saat user login
  ref.off();             // cegah listener ganda
  ref.on('value', s => {
    DB = s.val() || {};   // key = recordId (YYYY-MM-DD_Environment)
    if (!cur || !DB[cur]) cur = dates().slice(-1)[0] || null;
    render();
  }, e => {
    if (!authUser) return;   // listener dibatalkan karena logout
    console.error('Firebase Read Error:', e); setCS(false); toast('Gagal membaca database: ' + e.message, 'danger');
  });
}
function onLogin(user) {
  authUser = user;
  $('userEmail').textContent = user.email || ''; $('userEmail').title = user.email || '';
  $('loginPass').value = ''; loginMsg(''); loginBusy(false);
  showLogin(false);
  startSync();
}
function onLogout() {
  authUser = null;
  if (ref) ref.off();                                   // hentikan listener database
  DB = {}; cur = null; lastMon = '';                    // hapus data dari memori browser
  charts.forEach(c => c.destroy()); charts = [];
  $('cli').value = ''; $('q').value = ''; $('userEmail').textContent = '';
  document.querySelectorAll('.modal.show').forEach(m => { const i = bootstrap.Modal.getInstance(m); i && i.hide(); });
  render();
  loginBusy(false); showLogin(true);
}
$('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim(), pass = $('loginPass').value;
  if (!fbOk) return loginMsg('Firebase belum dikonfigurasi (cek firebaseConfig di app.js).');
  if (!email || !pass) return loginMsg('Email dan password wajib diisi.');
  loginMsg(''); loginBusy(true);
  firebase.auth().signInWithEmailAndPassword(email, pass)
    .catch(err => { console.error('Login Error:', err.code); loginMsg(authErr(err.code)); loginBusy(false); $('loginPass').value = ''; });
});
$('btnLogout').onclick = () => { if (ref) ref.off(); firebase.auth().signOut().catch(e => toast('Gagal logout: ' + e.message, 'danger')); };

/* ============ PARSER CLI ============ */
const HDRS = 'WORKER NODES|PODS STATUS|DEPLOYMENTS STATUS';
function split(txt) {
  txt = txt.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  let ms = [...txt.matchAll(new RegExp('^[ \\t]*={3,}\\s*(' + HDRS + ')\\s*={3,}[ \\t]*$', 'gim'))];   // baris header murni
  if (!ms.length) ms = [...txt.matchAll(new RegExp('={3,}\\s*(' + HDRS + ')\\s*={3,}', 'gi'))];     // fallback longgar
  const out = {};
  ms.forEach((m, i) => { out[m[1].toUpperCase().replace(/\s+/g, ' ')] = txt.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : undefined); });
  return out;
}
function tables(txt) {
  const out = []; let c = null;
  txt.split(/\r?\n/).forEach(l => {
    l = l.replace(/(\d+)\s+\(/g, '$1~(').replace(/\([^)]*\)/g, m => m.replace(/\s+/g, '~')).trim();   // "1 (10d ago)" -> satu token
    if (!l) { c = null; return; }
    const t = l.split(/\s+/);
    if (t[0].toUpperCase() === 'NAME') { c = { h: t.map(x => x.toUpperCase()), r: [] }; out.push(c); } else if (c) c.r.push(t);
  });
  return out;
}
const find = (tb, k) => tb.find(t => t.h.includes(k));
const mv = v => !v || v === '-' || /^<?unknown>?$/i.test(v) ? '' : v;   // metrics kosong/unknown => ""; "0m" & "0Mi" dipertahankan apa adanya
const numOrNull = n => isNaN(n) ? null : n;
function parse(txt) {
  const S = split(txt), w = tables(S['WORKER NODES'] || ''), p = tables(S['PODS STATUS'] || ''), d = tables(S['DEPLOYMENTS STATUS'] || '');
  const nodes = {}, mk = ip => nodes[ip] || (nodes[ip] = { ip, status: '', cpu: null, mem: null, disk: null, lock: false });
  const nt = find(w, 'STATUS'), tt = find(w, 'CPU%');
  if (nt) nt.r.forEach(r => { mk(r[0]).status = r[nt.h.indexOf('STATUS')] || ''; });
  if (tt) tt.r.forEach(r => { const n = mk(r[0]); n.cpu = R(r[tt.h.indexOf('CPU%')]); n.mem = R(r[tt.h.indexOf('MEMORY%')]); });
  const pt = find(p, 'STATUS'), ptop = find(p, 'CPU(CORES)'), top = {};
  if (ptop) ptop.r.forEach(r => { top[r[0]] = { cpu: r[ptop.h.indexOf('CPU(CORES)')], mem: r[ptop.h.indexOf('MEMORY(BYTES)')] }; });
  const pods = pt ? pt.r.map(r => {
    const h = pt.h, g = k => h.indexOf(k) >= 0 && r[h.indexOf(k)] ? r[h.indexOf(k)] : '', x = top[r[0]] || {};
    return { name: r[0], node: g('NODE'), ns: NS, status: g('STATUS'), restarts: numOrNull(parseInt(g('RESTARTS'))), cpu: mv(x.cpu), mem: mv(x.mem), age: g('AGE') };
  }) : [];
  const dt = find(d, 'AVAILABLE');
  const deps = dt ? dt.r.map(r => {
    const h = dt.h, rd = r[h.indexOf('READY')] || '';
    return { name: r[0], ready: rd, desired: parseInt(rd.split('/')[1]) || 0, avail: parseInt(r[h.indexOf('AVAILABLE')]) || 0, age: r[h.indexOf('AGE')] || '' };
  }) : [];
  const workers = Object.values(nodes);
  return workers.length || pods.length || deps.length ? { workers, pods, deployments: deps } : null;
}
/* --- Reduce Data Size: bersihkan field kosong + dedup ns + kompresi LZ-String (pods & deployments) --- */
const UC = new WeakMap(), kb = n => (n / 1024).toFixed(1) + ' KB';
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== '-' && v !== false));   // buang yang kosong; nilai nol (0, "0m", "0Mi", "0%") TETAP disimpan
function inflate(r) {   // ambil pods & deployments mentah (terkompresi maupun data lama)
  if (!r.compressedPayload) return { pods: r.pods, deployments: r.deployments ?? r.deps };
  try { const o = JSON.parse(LZString.decompressFromUTF16(r.compressedPayload)); return { pods: o.pods, deployments: o.deployments }; }
  catch (e) { console.error('Gagal dekompresi record', r.id, e); return { pods: [], deployments: [] }; }
}
function packRecord(rec) {
  const workers = A(rec.workers).map(clean);
  const pods = A(rec.pods).map(p => { const { ns, ...x } = p; if (ns && ns !== NS) x.ns = ns; return clean(x); });   // ns cukup di root
  const deployments = A(rec.deployments).map(clean);
  const out = { id: rec.id, date: rec.date, env: rec.env, ns: rec.ns || NS, workers, summary: rec.summary };
  if (typeof LZString !== 'undefined') out.compressedPayload = LZString.compressToUTF16(JSON.stringify({ pods, deployments }));
  else { out.pods = pods; out.deployments = deployments; console.warn('LZ-String tidak termuat, data disimpan tanpa kompresi'); }
  return out;
}
const dash = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '-' ? '' : v]));   // data lama bertanda "-" => kosong
function unpackRecord(r) {   // kompatibel data lama (tanpa kompresi) & baru (compressedPayload)
  if (!r) return r;
  if (UC.has(r)) return UC.get(r);
  const x = inflate(r), ns = r.ns || NS;
  const out = { ...r, ns,
    workers: A(r.workers).map(w => ({ ip: '', status: '', cpu: null, mem: null, disk: null, lock: false, ...dash(w) })),
    pods: A(x.pods).map(p => ({ name: '', node: '', status: '', restarts: null, cpu: '', mem: '', age: '', ...dash(p), ns: p.ns || ns })),
    deployments: A(x.deployments).map(d => ({ name: '', ready: '', desired: 0, avail: 0, age: '', ...dash(d) })) };
  UC.set(r, out); return out;
}
const summary = r => { const s = sm(r); return { ready: s.ready, notReady: s.nr, running: s.run, failed: s.fail, depAvailable: s.da, depTotal: s.td, peakWorkerCpu: s.H, peakWorkerMem: s.I, peakPodCpu: s.pc, peakPodMem: s.pm, overall: s.st }; };
function doParse() {
  const txt = $('cli').value, date = $('pdate').value;
  if (!ref) return toast('Firebase belum terhubung (cek firebaseConfig)', 'danger');
  if (!date || !txt.trim()) return toast('Isi tanggal dan paste output terminal', 'danger');
  const r = parse(txt);
  if (!r) return toast('Header "=== WORKER NODES ===" dst. tidak ditemukan atau tabel kosong', 'danger');
  const cleanEnv = sanitizeKey(ENV), id = `${date}_${cleanEnv}`, old = A((DB[id] || {}).workers);   // 2026-10-29_Prod_BTN_Syariah_Kubernetes
  r.workers.forEach(w => { const o = old.find(x => x.ip === w.ip); if (o && o.lock) { w.disk = o.disk; w.lock = true; } });   // pertahankan Disk terkunci
  const rec = { id, date, env: ENV, ns: NS, ...r }; rec.summary = summary(rec);
  const packed = packRecord(rec), before = new Blob([JSON.stringify(rec)]).size, after = new Blob([JSON.stringify(packed)]).size;
  cur = id;
  firebase.database().ref('k8s_monitoring/records/' + id).set(JSON.parse(JSON.stringify(packed)))
    .then(() => {
      toast(`Tersimpan! Ukuran data dikompresi ${Math.max(0, Math.round((1 - after / before) * 100))}% (dari ${kb(before)} menjadi ${kb(after)})`);
      $('cli').value = '';
    })
    .catch(e => {
      console.error("Firebase Set Error:", e);
      alert("Gagal menyimpan ke Firebase: " + e.message);
    });
}

/* ============ RINGKASAN & RUMUS ============ */
const mx = (w, k) => { let b = null; w.forEach(x => { if (x[k] != null && (b == null || x[k] > b[k])) b = x; }); return b; };
const mp = (p, k, u) => { const v = p.map(x => parseInt(x[k])).filter(n => !isNaN(n)); return v.length ? Math.max(...v) + u : ''; };   // "0m"/"0Mi" tetap tampil; "" jika tak ada metrics
function sm(r) {
  r = unpackRecord(r);
  const w = A(r.workers), p = A(r.pods), d = A(r.deployments);
  const ready = w.filter(x => /^ready/i.test(x.status)).length, nr = w.length - ready;
  const run = p.filter(x => /^running$/i.test(x.status)).length, fail = p.filter(x => /^failed$/i.test(x.status)).length;   // Failed = strict
  const da = d.filter(x => x.desired > 0 && x.avail >= x.desired).length;
  const bc = mx(w, 'cpu'), bm = mx(w, 'mem'), H = bc ? bc.cpu : null, I = bm ? bm.mem : null, h = H || 0, i = I || 0;
  const st = (nr > 1 || fail > 5 || h > 90 || i > 90) ? 'CRITICAL' : (nr > 0 || fail > 0 || h > 80 || i > 80) ? 'WARNING' : 'HEALTHY';
  return { w, p, d, ready, nr, run, fail, tp: p.length, da, td: d.length, bc, bm, H, I, pc: mp(p, 'cpu', 'm'), pm: mp(p, 'mem', 'Mi'), st, anom: h > 80 || i > 80 || p.some(x => x.restarts > 10) };
}

/* ============ RENDER ============ */
function render() {
  if (document.activeElement && document.activeElement.classList.contains('disk-in')) return;
  $('dsel').innerHTML = dates().reverse().map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${fd(d)}${DB[d].env && DB[d].env !== ENV ? ' - ' + esc(DB[d].env) : ''}</option>`).join('') || '<option value="">-</option>';
  const r = DB[cur];
  syncMon(); updateDbUsage(); kpi(r); exec(); detail(r);
  if (tabNow === 't2') drawCharts();
}
function updateDbUsage() {
  const el = $('dbUsageInfo'); if (!el) return;
  const bytes = new Blob([JSON.stringify(DB || {})]).size, QUOTA = 1073741824, pct = bytes / QUOTA * 100;
  const sz = bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(2) + ' KB';
  el.className = 'db-pill ' + (pct > 80 ? 'text-danger fw-semibold' : 'text-muted');
  el.innerHTML = `<i class="fa-solid fa-database me-1"></i> Cloud Storage: <b>${sz}</b> / 1 GB (${pct.toFixed(4)}%)`;
}
function kpi(r) {
  if (!r) { ['k1', 'k2', 'k3', 'k4'].forEach(k => $(k).innerHTML = '<div class="kv">&nbsp;</div><div class="ks">Belum ada data</div>'); return; }
  const s = sm(r);
  $('k1').innerHTML = `<div class="kv">${s.ready}/${s.w.length}</div><div class="ks">Ready &nbsp;|&nbsp; <b>${s.nr}</b> Not Ready</div>`;
  $('k2').innerHTML = `<div class="kv">${s.run}/${s.tp}</div><div class="ks">Running &nbsp;|&nbsp; <b>${s.fail}</b> Failed</div>`;
  $('k3').innerHTML = `<div class="kv">${s.H == null && s.I == null ? '&nbsp;' : P(s.H) + ' / ' + P(s.I)}</div><div class="ks">CPU ${s.bc ? esc(s.bc.ip) : ''} &nbsp;|&nbsp; Mem ${s.bm ? esc(s.bm.ip) : ''}</div>`;
  $('k4').innerHTML = `<span class="bdg big ${s.st}">${SL[s.st]}</span><div class="ks">Data ${fd(cur)}</div>`;
}
const filtered = () => { const f = $('fFrom').value, t = $('fTo').value, m = $('fMon').value; return dates().filter(id => { const d = id.slice(0, 10); return (!f || d >= f) && (!t || d <= t) && (!m || d.startsWith(m)); }); };
function exec() {
  $('tb1').innerHTML = filtered().reverse().map(d => {
    const s = sm(DB[d]);
    return `<tr class="${s.anom ? 'anomaly' : ''}"><td>${fd(d)}</td><td>${esc(DB[d].env || ENV)}</td><td>${s.ready}</td><td>${s.nr}</td><td>${s.run}</td><td>${s.fail}</td><td>${s.da}/${s.td}</td><td>${P(s.H)}</td><td>${P(s.I)}</td><td>${s.pc}</td><td>${s.pm}</td><td>${bd(s.st)}</td><td><button class="btn btn-sm btn-outline-danger py-0 px-1" data-del="${d}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
  }).join('') || '<tr><td colspan="13" class="text-center text-muted py-4">Belum ada data. Buka tab "CLI Parser &amp; Data Detail" untuk menempel output terminal.</td></tr>';
}
function detail(r) {
  const s = r ? sm(r) : { w: [], p: [], d: [] };
  $('tb2').innerHTML = s.w.map((x, i) => `<tr class="${[x.cpu, x.mem, x.disk].some(v => v > 80) ? 'anomaly' : ''}"><td>${esc(x.ip)}</td><td>${!x.status ? '' : bd(/^ready/i.test(x.status) ? 'HEALTHY' : 'CRITICAL').replace(SL.HEALTHY, esc(x.status)).replace(SL.CRITICAL, esc(x.status))}</td><td>${P(x.cpu)}</td><td>${P(x.mem)}</td><td>${x.lock ? P(x.disk) + ' <i class="fa-solid fa-lock text-muted small" title="Terkunci"></i>' : `<input class="form-control form-control-sm disk-in" data-i="${i}" placeholder="isi %" inputmode="decimal">`}</td><td>${bd(rm(x))}</td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">Belum ada data</td></tr>';
  $('tb3').innerHTML = s.p.map(x => `<tr class="${x.restarts > 10 ? 'anomaly' : ''}"><td>${esc(x.name)}</td><td>${esc(x.node)}</td><td>${esc(x.ns)}</td><td>${pb(x.status)}</td><td>${x.restarts}</td><td>${esc(x.cpu)}</td><td>${esc(x.mem)}</td><td>${esc(x.age)}</td></tr>`).join('') || '<tr><td colspan="8" class="text-center text-muted py-3">Belum ada data</td></tr>';
  $('tb4').innerHTML = s.d.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.ready)}</td><td>${x.avail}</td><td>${esc(x.age)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">Belum ada data</td></tr>';
  applyQ();
}
function applyQ() { const q = $('q').value.toLowerCase(); document.querySelectorAll('#tb2 tr,#tb3 tr,#tb4 tr').forEach(tr => tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q)); }

/* ============ DISK: ONE-TIME INPUT & LOCK ============ */
$('tb2').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('disk-in')) e.target.blur(); });
$('tb2').addEventListener('focusout', e => {
  const t = e.target; if (!t.classList.contains('disk-in')) return;
  const v = R(t.value);
  if (v == null || !ref) return render();
  ref.child(`${cur}/workers/${t.dataset.i}`).update({ disk: Math.min(100, Math.max(0, v)), lock: true });
});

/* ============ CHART.JS ============ */
function syncMon() { const m = cur ? cur.slice(0, 7) : ''; if (m && m !== lastMon) { lastMon = m; $('cmon').value = m; } }
function drawCharts() {
  charts.forEach(c => c.destroy()); charts = [];
  const mode = document.querySelector('[name=cv]:checked').value;
  $('cmonW').classList.toggle('d-none', mode === 'd');
  const m = $('cmon').value, ids = dates().filter(d => d.startsWith(m)), days = [...new Set(ids.map(d => d.slice(0, 10)))];   // kronologis
  const wk = day => ids.filter(i => i.startsWith(day)).flatMap(i => A(DB[i].workers));
  const ips = [...new Set(days.flatMap(day => wk(day).map(x => x.ip)))].sort();
  const color = i => COL[i] || `hsl(${(i * 47) % 360},65%,42%)`;
  const tick = { callback: v => v + '%' };
  [['cpu', 'CPU %', 'c1'], ['mem', 'Memory %', 'c2'], ['disk', 'Disk %', 'c3']].forEach(([k, t, id]) => {
    const y = k === 'cpu' ? { min: 0, suggestedMax: 10, ticks: tick } : { min: 0, max: 100, ticks: tick };
    let cfg;
    if (mode === 'd') {
      const w = A((DB[cur] || {}).workers);
      cfg = { type: 'bar', data: { labels: w.map(x => x.ip), datasets: [{ label: t, data: w.map(x => x[k] ?? null), backgroundColor: w.map((x, i) => color(i)), borderRadius: 6 }] } };
    } else {
      cfg = { type: 'line', data: { labels: days.map(fd), datasets: ips.map((ip, i) => ({ label: ip, data: days.map(day => { const x = wk(day).find(z => z.ip === ip); return x && x[k] != null ? x[k] : null; }), borderColor: color(i), backgroundColor: color(i), tension: 0.3, pointRadius: 4, pointHoverRadius: 6, fill: false, spanGaps: true })) } };
    }
    cfg.options = { responsive: true, maintainAspectRatio: false, interaction: { mode: mode === 'm' ? 'index' : 'nearest', intersect: false }, scales: { y, x: { title: { display: mode === 'm', text: 'Tanggal (DD/MM/YYYY)' } } }, plugins: { legend: { display: mode === 'm', position: 'top', labels: { usePointStyle: false, boxWidth: 14, boxHeight: 14 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y == null ? '-' : c.parsed.y + '%'}` } }, title: { display: true, text: t + (mode === 'd' ? ' per Worker Node (' + (cur ? fd(cur) : '-') + ')' : ' - Tren Bulanan' + (m ? ' (' + m.split('-').reverse().join('/') + ')' : '')) } } };
    charts.push(new Chart($(id), cfg));
  });
}

/* ============ QUICK REPORT ============ */
function daily() {
  const r = DB[cur]; if (!r) return toast('Belum ada data', 'danger');
  const s = sm(r);
  return ['*📊 DAILY REPORT KUBERNETES*', `Environment: ${ENV}`, `Tanggal: ${fd(cur)}`, '',
    `*Worker*: ${s.ready} Ready / ${s.nr} Not Ready`, `*Pod*: ${s.run} Running / ${s.fail} Failed`, `*Deployment*: ${s.da}/${s.td} Available`,
    `*Worker CPU Tertinggi*: ${P(s.H)}${s.bc ? ' (' + s.bc.ip + ')' : ''}`, `*Worker Memory Tertinggi*: ${P(s.I)}${s.bm ? ' (' + s.bm.ip + ')' : ''}`,
    `*Pods CPU Tertinggi*: ${s.pc}`, `*Pods Memory Tertinggi*: ${s.pm}`, '', `*Overall Status*: ${SL[s.st]}`].join('\n');
}
function monthly() {
  const m = (cur || '').slice(0, 7);
  const ds = dates().filter(d => d.startsWith(m));
  if (!ds.length) return toast('Belum ada data bulan ini', 'danger');

  const S = ds.map(d => ({ id: d, date: fd(d), s: sm(DB[d]) }));
  const countSt = k => S.filter(x => x.s.st === k).length;

  // Format nama bulan (misal: "11/2026" -> "November 2026")
  const [yr, mo] = m.split('-');
  const namaBulan = new Date(yr, parseInt(mo) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  // Hitung rata-rata & total insiden
  const avgRun = Math.round(S.reduce((acc, x) => acc + x.s.run, 0) / S.length);
  const totalFail = S.reduce((acc, x) => acc + x.s.fail, 0);
  const totalNotReady = S.reduce((acc, x) => acc + x.s.nr, 0);
  const latest = S[S.length - 1].s;

  // Cari Peak Usage sebulan beserta tanggal kejadiannya
  let maxCpu = { val: -1, date: '-' }, maxMem = { val: -1, date: '-' };
  let maxPodCpu = { val: -1, str: '-', date: '-' }, maxPodMem = { val: -1, str: '-', date: '-' };

  S.forEach(({ date, s }) => {
    if (s.H != null && s.H > maxCpu.val) maxCpu = { val: s.H, date };
    if (s.I != null && s.I > maxMem.val) maxMem = { val: s.I, date };
    
    const pCpuNum = parseInt(s.pc);
    if (!isNaN(pCpuNum) && pCpuNum > maxPodCpu.val) maxPodCpu = { val: pCpuNum, str: s.pc, date };
    
    const pMemNum = parseInt(s.pm);
    if (!isNaN(pMemNum) && pMemNum > maxPodMem.val) maxPodMem = { val: pMemNum, str: s.pm, date };
  });

  // Status keseluruhan bulan
  const critDays = countSt('CRITICAL'), warnDays = countSt('WARNING');
  const overallMonth = critDays > 0 ? '🔴 PERLU PERHATIAN (Terdapat Hari Critical)' 
                     : warnDays > 0 ? '🟡 CUKUP STABIL (Terdapat Hari Warning)' 
                     : '🟢 STABIL / HEALTHY';

  return [
    '*📅 MONTHLY SUMMARY REPORT KUBERNETES*',
    `*Environment*: ${ENV}`,
    `*Periode*: ${namaBulan} (${ds.length} Hari Tercatat)`,
    '',
    '*📊 Ringkasan Status Cluster*',
    `• 🟢 Healthy: ${countSt('HEALTHY')} Hari`,
    `• 🟡 Warning: ${warnDays} Hari`,
    `• 🔴 Critical: ${critDays} Hari`,
    '',
    '*⚙️ Stabilitas Infrastruktur & Workload*',
    `• *Worker Nodes*: ${latest.ready}/${latest.w.length} Ready (${totalNotReady} Insiden Not Ready)`,
    `• *Pods Status*: Rata-rata ${avgRun} Running (Total ${totalFail} Failed)`,
    `• *Deployments*: ${latest.da}/${latest.td} Available`,
    '',
    '*📈 Puncak Penggunaan Resource (Peak Usage)*',
    `• *Peak Worker CPU*: ${maxCpu.val >= 0 ? maxCpu.val + '% (' + maxCpu.date + ')' : '-'}`,
    `• *Peak Worker Memory*: ${maxMem.val >= 0 ? maxMem.val + '% (' + maxMem.date + ')' : '-'}`,
    `• *Peak Pods CPU*: ${maxPodCpu.val >= 0 ? maxPodCpu.str + ' (' + maxPodCpu.date + ')' : '-'}`,
    `• *Peak Pods Memory*: ${maxPodMem.val >= 0 ? maxPodMem.str + ' (' + maxPodMem.date + ')' : '-'}`,
    '',
    `*Kesimpulan Kesehatan Bulanan*: ${overallMonth}`
  ].join('\n');
}

/* ============ EXPORT EXCEL / CSV ============ */
function sheets(ds) {
  const S = { 'Daily Summary': [], 'Worker Monitoring': [], 'Pod Monitoring': [], 'Deployment Health': [] };
  ds.forEach(d => {
    const s = sm(DB[d]), t = fd(d);
    S['Daily Summary'].push({ Tanggal: t, Environment: DB[d].env || ENV, 'Worker Ready': s.ready, 'Worker Not Ready': s.nr, 'Running Pod': s.run, 'Failed Pod': s.fail, 'Deployment Available': `${s.da}/${s.td}`, 'Worker CPU Tertinggi (%)': P(s.H), 'Worker Memory Tertinggi (%)': P(s.I), 'Pods CPU Tertinggi (%)': s.pc, 'Pods Memory Tertinggi (%)': s.pm, 'Overall Status': SL[s.st] });
    s.w.forEach(x => S['Worker Monitoring'].push({ Tanggal: t, 'Worker IP': x.ip, Status: x.status, 'CPU %': P(x.cpu), 'Memory %': P(x.mem), 'Disk %': P(x.disk), Remark: SL[rm(x)] }));
    s.p.forEach(x => S['Pod Monitoring'].push({ Tanggal: t, 'Pod Name': x.name, Node: x.node, Namespace: x.ns, Status: x.status, 'Restart Count': x.restarts, CPU: x.cpu, Memory: x.mem, Age: x.age }));
    s.d.forEach(x => S['Deployment Health'].push({ Tanggal: t, Deployment: x.name, Ready: x.ready, Available: x.avail, Age: x.age }));
  });
  return S;
}
$('exGo').onclick = () => {
  const fmt = document.querySelector('[name=xf]:checked').value, rg = document.querySelector('[name=xr]:checked').value, d = $('exDate').value;
  if (!d) return toast('Pilih tanggal acuan', 'danger');
  const ds = dates().filter(x => rg === 'd' ? x.slice(0, 10) === d : x.startsWith(d.slice(0, 7)));
  if (!ds.length) return toast('Tidak ada data pada periode tersebut', 'danger');
  const S = sheets(ds), nm = 'K8s_Monitoring_' + (rg === 'd' ? 'Daily_' + d : 'Monthly_' + d.slice(0, 7)), wb = XLSX.utils.book_new();
  Object.entries(S).forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n));
  if (fmt === 'x') XLSX.writeFile(wb, nm + '.xlsx');
  else dl(new Blob(['\ufeff' + wb.SheetNames.map(n => '### ' + n + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n')], { type: 'text/csv;charset=utf-8' }), nm + '.csv');
  bootstrap.Modal.getOrCreateInstance($('mEx')).hide();
  toast('File berhasil diunduh');
};

/* ============ EVENT BINDING ============ */
$('cmdTxt').textContent = CMD;
$('pdate').value = today();
$('cpCmd').onclick = () => cp(CMD);
$('cpD').onclick = () => { const t = daily(); t && cp(t); };
$('cpM').onclick = () => { const t = monthly(); t && cp(t); };
$('goParse').onclick = doParse;
$('clr').onclick = () => { $('cli').value = ''; };
$('q').oninput = applyQ;
$('dsel').onchange = e => { cur = e.target.value || null; render(); };
['fFrom', 'fTo', 'fMon'].forEach(i => $(i).onchange = exec);
$('fClr').onclick = () => { ['fFrom', 'fTo', 'fMon'].forEach(i => $(i).value = ''); exec(); };
document.querySelectorAll('[name=cv]').forEach(e => e.onchange = drawCharts);
$('cmon').onchange = drawCharts;
document.querySelectorAll('#mainTabs button').forEach(b => b.addEventListener('shown.bs.tab', e => { tabNow = e.target.dataset.t; if (tabNow === 't2') drawCharts(); }));
$('mEx').addEventListener('show.bs.modal', () => { $('exDate').value = cur ? cur.slice(0, 10) : today(); });
$('cmOk').onclick = () => { bootstrap.Modal.getOrCreateInstance($('mCf')).hide(); const f = cfm; cfm = null; f && f(); };
$('tb1').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b || !ref) return;
  const d = b.dataset.del;
  ask(`Apakah Anda yakin ingin menghapus data tanggal ${fd(d)}?`, () => ref.child(d).remove().then(() => toast('Data dihapus')));
});

/* ============ BACKUP & RESTORE JSON ============ */
const U = (v, unit) => { v = v == null ? '' : String(v).trim(); return mv(/^\d+(\.\d+)?$/.test(v) ? v + unit : v); };   // 0 => "0m"/"0Mi"; kosong => ""
const pick = (o, ...k) => { for (const x of k) if (o && o[x] != null && o[x] !== '') return o[x]; return null; };
function norm(r) {   // normalisasi 1 record (format lama / baru) -> struktur Firebase
  if (!r || typeof r !== 'object') return null;
  const raw = String(r.id || ''), parts = raw.split(/[|_]/), date = String(r.date || parts[0]).slice(0, 10);
  if (!DATE_RE.test(date)) return null;
  const cleanId = `${date}_${sanitizeKey(ENV)}`, X = inflate(r);   // ID sama persis dengan doParse(); X = pods/deployments (otomatis dekompresi)
  const workers = A(r.workers).map(w => { const disk = R(pick(w, 'disk', 'diskPct', 'disk%', 'diskPercent')); return { ip: String(pick(w, 'ip', 'name', 'node', 'worker') || ''), status: String(pick(w, 'status') || ''), cpu: R(pick(w, 'cpu', 'cpuPct', 'cpu%', 'cpuPercent')), mem: R(pick(w, 'mem', 'memory', 'memPct', 'mem%', 'memoryPct', 'memoryPercent')), disk, lock: disk != null }; });
  const pods = A(X.pods).map(p => ({ name: String(pick(p, 'name', 'pod', 'podName') || ''), node: String(pick(p, 'node', 'nodeName') || ''), ns: String(pick(p, 'ns', 'namespace') || NS), status: String(pick(p, 'status', 'phase') || ''), restarts: numOrNull(parseInt(pick(p, 'restarts', 'restart', 'restartCount'))), cpu: U(pick(p, 'cpu'), 'm'), mem: U(pick(p, 'mem', 'memory'), 'Mi'), age: String(pick(p, 'age') || '') }));
  const deployments = A(X.deployments).map(d => {
    const rd = String(pick(d, 'ready') || ''), m = rd.match(/(\d+)\s*\/\s*(\d+)/);
    const avail = parseInt(pick(d, 'available', 'avail', 'availableReplicas') ?? (m ? m[1] : 0)) || 0, desired = m ? +m[2] : (parseInt(pick(d, 'desired', 'replicas')) || 0);
    return { name: String(pick(d, 'name', 'deployment') || ''), ready: m ? rd : `${avail}/${desired}`, desired, avail, age: String(pick(d, 'age') || '') };
  });
  const rec = { id: cleanId, date, env: ENV, ns: NS, workers, pods, deployments };
  rec.summary = r.summary && r.summary.overall ? r.summary : summary(rec);   // hitung ulang jika belum ada
  return packRecord(rec);   // kurangi ukuran sebelum .set() ke Firebase
}
function readBackup(o) {
  if (o && Array.isArray(o.records)) return { recs: o.records, legacy: !(o.version >= 2) };
  if (o && o.records && typeof o.records === 'object') return { recs: Object.values(o.records), legacy: false };
  const k = o && typeof o === 'object' ? Object.keys(o) : [];
  if (k.length && k.every(x => DATE_RE.test(x))) return { recs: Object.values(o), legacy: true };   // backup versi pertama (key = tanggal)
  throw new Error('Struktur JSON tidak dikenali');
}
function notify(msg, ok = true) {
  $('okIc').className = 'fa-solid fa-3x mb-3 ' + (ok ? 'fa-circle-check text-success' : 'fa-circle-exclamation text-danger');
  $('okMsg').textContent = msg; bootstrap.Modal.getOrCreateInstance($('mOk')).show();
}
$('bkExp').onclick = e => { e.preventDefault(); dl(new Blob([JSON.stringify({ app: 'k8s-dashboard', version: 2, exportedAt: new Date().toISOString(), records: dates().map(id => DB[id]) }, null, 2)], { type: 'application/json' }), `k8s_backup_${today()}.json`); };
$('bkImp').onclick = e => { e.preventDefault(); $('bkFile').click(); };
$('bkFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      if (!ref) throw new Error('Firebase belum terhubung (cek firebaseConfig)');
      const { recs, legacy } = readBackup(JSON.parse(rd.result)), ok = recs.map(norm).filter(Boolean);
      if (!ok.length) throw new Error('Tidak ada record valid di file ini');
      await Promise.all(ok.map(r => firebase.database().ref(REC + r.id).set(JSON.parse(JSON.stringify(r)))));
      notify(`Berhasil mengimpor ${ok.length} data harian dari ${legacy ? 'JSON lama' : 'file backup'} ke Firebase Cloud!` + (recs.length > ok.length ? ` (${recs.length - ok.length} record dilewati karena tidak valid)` : ''));
    } catch (x) { console.error('Firebase Import Error:', x); notify('Import gagal: ' + (x instanceof SyntaxError ? 'file bukan JSON yang valid' : x.message), false); }
    e.target.value = '';
  };
  rd.readAsText(f);
};
$('rst').onclick = e => { e.preventDefault(); ask('Hapus SEMUA data monitoring dari cloud? Tindakan ini tidak dapat dibatalkan.', () => ref && ref.remove().then(() => toast('Semua data direset'))); };

initFirebase();
render();
