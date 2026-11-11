/* ============ FIREBASE CONFIG (ISI DI SINI) ============ */
const firebaseConfig = {
  apiKey: "AIzaSyCbS4BwZn-znx3c9VZk3WQFP_I1nys2iHY",
  authDomain: "k8s-monitoring-ito.firebaseapp.com",
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
const COL = ['#046748', '#2563EB', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#475569'];
let DB = {}, cur = null, ref = null, charts = [], tabNow = 't1', cfm = null;

/* ============ HELPER ============ */
const $ = id => document.getElementById(id);
const A = x => x ? Object.values(x) : [];
const R = v => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n); };   // Math.round standar
const P = v => v == null ? '-' : v + '%';
const fd = d => d.split('-').reverse().join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dates = () => Object.keys(DB).sort();
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const bd = s => `<span class="bdg ${s}">${SL[s]}</span>`;
const pb = s => `<span class="bdg ${/^(running|completed|succeeded)$/i.test(s) ? 'HEALTHY' : /pending|creating|init|terminating/i.test(s) ? 'WARNING' : 'CRITICAL'}">${esc(s)}</span>`;
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

/* ============ FIREBASE REALTIME SYNC ============ */
try {
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  ref = db.ref('k8s_monitoring');
  db.ref('.info/connected').on('value', s => setCS(s.val() === true));
  ref.on('value', s => {
    DB = s.val() || {};
    if (!cur || !DB[cur]) cur = dates().slice(-1)[0] || null;
    render();
  }, e => { setCS(false); toast('Gagal membaca database: ' + e.message, 'danger'); });
} catch (e) { setCS(false); toast('Firebase belum dikonfigurasi (cek firebaseConfig di app.js)', 'danger'); }

/* ============ PARSER CLI ============ */
const sec = (t, n) => { const m = t.match(new RegExp('===\\s*' + n + '\\s*===([\\s\\S]*?)(?====|$)', 'i')); return m ? m[1] : ''; };
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
const zero = v => !v || /^0+(m|mi)?$/i.test(v) ? '-' : v;   // kosong / 0m / 0Mi => "-"
function parse(txt) {
  const w = tables(sec(txt, 'WORKER NODES')), p = tables(sec(txt, 'PODS STATUS')), d = tables(sec(txt, 'DEPLOYMENTS STATUS'));
  const nodes = {}, mk = ip => nodes[ip] || (nodes[ip] = { ip, status: '-', cpu: null, mem: null, disk: null, lock: false });
  const nt = find(w, 'STATUS'), tt = find(w, 'CPU%');
  if (nt) nt.r.forEach(r => { mk(r[0]).status = r[nt.h.indexOf('STATUS')] || '-'; });
  if (tt) tt.r.forEach(r => { const n = mk(r[0]); n.cpu = R(r[tt.h.indexOf('CPU%')]); n.mem = R(r[tt.h.indexOf('MEMORY%')]); });
  const pt = find(p, 'STATUS'), ptop = find(p, 'CPU(CORES)'), top = {};
  if (ptop) ptop.r.forEach(r => { top[r[0]] = { cpu: r[ptop.h.indexOf('CPU(CORES)')], mem: r[ptop.h.indexOf('MEMORY(BYTES)')] }; });
  const pods = pt ? pt.r.map(r => {
    const h = pt.h, g = k => h.indexOf(k) >= 0 && r[h.indexOf(k)] ? r[h.indexOf(k)] : '-', x = top[r[0]] || {};
    return { name: r[0], node: g('NODE'), ns: NS, status: g('STATUS'), restarts: parseInt(g('RESTARTS')) || 0, cpu: zero(x.cpu), mem: zero(x.mem), age: g('AGE') };
  }) : [];
  const dt = find(d, 'AVAILABLE');
  const deps = dt ? dt.r.map(r => {
    const h = dt.h, rd = r[h.indexOf('READY')] || '0/0';
    return { name: r[0], ready: rd, desired: parseInt(rd.split('/')[1]) || 0, avail: parseInt(r[h.indexOf('AVAILABLE')]) || 0, age: r[h.indexOf('AGE')] || '-' };
  }) : [];
  const workers = Object.values(nodes);
  return workers.length || pods.length || deps.length ? { workers, pods, deployments: deps } : null;
}
function doParse() {
  const txt = $('cli').value, date = $('pdate').value;
  if (!ref) return toast('Firebase belum terhubung', 'danger');
  if (!date || !txt.trim()) return toast('Isi tanggal dan paste output terminal', 'danger');
  const r = parse(txt);
  if (!r) return toast('Header "=== WORKER NODES ===" dst. tidak ditemukan', 'danger');
  const old = A((DB[date] || {}).workers);
  r.workers.forEach(w => { const o = old.find(x => x.ip === w.ip); if (o && o.lock) { w.disk = o.disk; w.lock = true; } });   // pertahankan Disk terkunci
  cur = date;
  ref.child(date).set(JSON.parse(JSON.stringify({ date, environment: ENV, ...r })))
    .then(() => { toast(`Tersimpan: ${r.workers.length} worker, ${r.pods.length} pod, ${r.deployments.length} deployment`); $('cli').value = ''; })
    .catch(e => toast('Gagal menyimpan: ' + e.message, 'danger'));
}

/* ============ RINGKASAN & RUMUS ============ */
const mx = (w, k) => { let b = null; w.forEach(x => { if (x[k] != null && (b == null || x[k] > b[k])) b = x; }); return b; };
const mp = (p, k, u) => { const v = p.map(x => parseInt(x[k])).filter(n => n > 0); return v.length ? Math.max(...v) + u : '-'; };
function sm(r) {
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
  $('dsel').innerHTML = dates().reverse().map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${fd(d)}</option>`).join('') || '<option value="">-</option>';
  const r = DB[cur];
  kpi(r); exec(); detail(r);
  if (tabNow === 't2') drawCharts();
}
function kpi(r) {
  if (!r) { ['k1', 'k2', 'k3', 'k4'].forEach(k => $(k).innerHTML = '<div class="kv">-</div><div class="ks">Belum ada data</div>'); return; }
  const s = sm(r);
  $('k1').innerHTML = `<div class="kv">${s.ready}/${s.w.length}</div><div class="ks">Ready &nbsp;|&nbsp; <b>${s.nr}</b> Not Ready</div>`;
  $('k2').innerHTML = `<div class="kv">${s.run}/${s.tp}</div><div class="ks">Running &nbsp;|&nbsp; <b>${s.fail}</b> Failed</div>`;
  $('k3').innerHTML = `<div class="kv">${P(s.H)} / ${P(s.I)}</div><div class="ks">CPU ${s.bc ? esc(s.bc.ip) : '-'} &nbsp;|&nbsp; Mem ${s.bm ? esc(s.bm.ip) : '-'}</div>`;
  $('k4').innerHTML = `<span class="bdg big ${s.st}">${SL[s.st]}</span><div class="ks">Data ${fd(cur)}</div>`;
}
const filtered = () => { const f = $('fFrom').value, t = $('fTo').value, m = $('fMon').value; return dates().filter(d => (!f || d >= f) && (!t || d <= t) && (!m || d.startsWith(m))); };
function exec() {
  $('tb1').innerHTML = filtered().reverse().map(d => {
    const s = sm(DB[d]);
    return `<tr class="${s.anom ? 'anomaly' : ''}"><td>${fd(d)}</td><td>${esc(DB[d].environment || ENV)}</td><td>${s.ready}</td><td>${s.nr}</td><td>${s.run}</td><td>${s.fail}</td><td>${s.da}/${s.td}</td><td>${P(s.H)}</td><td>${P(s.I)}</td><td>${s.pc}</td><td>${s.pm}</td><td>${bd(s.st)}</td><td><button class="btn btn-sm btn-outline-danger py-0 px-1" data-del="${d}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
  }).join('') || '<tr><td colspan="13" class="text-center text-muted py-4">Belum ada data. Buka tab "CLI Parser &amp; Data Detail" untuk menempel output terminal.</td></tr>';
}
function detail(r) {
  const s = r ? sm(r) : { w: [], p: [], d: [] };
  $('tb2').innerHTML = s.w.map((x, i) => `<tr class="${[x.cpu, x.mem, x.disk].some(v => v > 80) ? 'anomaly' : ''}"><td>${esc(x.ip)}</td><td>${bd(/^ready/i.test(x.status) ? 'HEALTHY' : 'CRITICAL').replace(SL.HEALTHY, esc(x.status)).replace(SL.CRITICAL, esc(x.status))}</td><td>${P(x.cpu)}</td><td>${P(x.mem)}</td><td>${x.lock ? P(x.disk) + ' <i class="fa-solid fa-lock text-muted small" title="Terkunci"></i>' : `<input class="form-control form-control-sm disk-in" data-i="${i}" placeholder="isi %" inputmode="decimal">`}</td><td>${bd(rm(x))}</td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">Belum ada data</td></tr>';
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
function drawCharts() {
  charts.forEach(c => c.destroy()); charts = [];
  const mode = document.querySelector('[name=cv]:checked').value;
  $('cmonW').classList.toggle('d-none', mode === 'd');
  if (!$('cmon').value && cur) $('cmon').value = cur.slice(0, 7);
  [['cpu', 'CPU %', 'c1'], ['mem', 'Memory %', 'c2'], ['disk', 'Disk %', 'c3']].forEach(([k, t, id]) => {
    const y = { beginAtZero: true, ticks: { callback: v => v + '%' }, ...(k === 'cpu' ? { suggestedMax: 10 } : { min: 0, max: 100 }) };
    let cfg;
    if (mode === 'd') {
      const w = A((DB[cur] || {}).workers);
      cfg = { type: 'bar', data: { labels: w.map(x => x.ip), datasets: [{ label: t, data: w.map(x => x[k] ?? null), backgroundColor: w.map((x, i) => COL[i % COL.length]), borderRadius: 6 }] } };
    } else {
      const ds = dates().filter(d => d.startsWith($('cmon').value)), ips = [...new Set(ds.flatMap(d => A(DB[d].workers).map(x => x.ip)))];
      cfg = { type: 'line', data: { labels: ds.map(fd), datasets: ips.map((ip, i) => ({ label: ip, data: ds.map(d => { const x = A(DB[d].workers).find(z => z.ip === ip); return x && x[k] != null ? x[k] : null; }), borderColor: COL[i % COL.length], backgroundColor: COL[i % COL.length], tension: .3, spanGaps: true })) } };
    }
    cfg.options = { responsive: true, maintainAspectRatio: false, scales: { y, x: { title: { display: mode === 'm', text: 'Tanggal (DD/MM/YYYY)' } } }, plugins: { legend: { display: mode === 'm' }, title: { display: true, text: t + (mode === 'd' ? ' per Worker Node (' + (cur ? fd(cur) : '-') + ')' : ' - Tren Bulanan') } } };
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
  const m = (cur || '').slice(0, 7), ds = dates().filter(d => d.startsWith(m)); if (!ds.length) return toast('Belum ada data bulan ini', 'danger');
  const S = ds.map(d => [d, sm(DB[d])]), n = k => S.filter(x => x[1].st === k).length;
  return ['*📅 MONTHLY REPORT KUBERNETES*', `Environment: ${ENV}`, `Periode: ${m.split('-').reverse().join('/')}`, `Hari Tercatat: ${ds.length}`,
    `🟢 ${n('HEALTHY')} | 🟡 ${n('WARNING')} | 🔴 ${n('CRITICAL')}`, '', 'Tgl | Worker Ready/NotReady | Pod Run/Failed | Dep | CPU | Mem | Status',
    ...S.map(([d, s]) => `${fd(d).slice(0, 5)} | ${s.ready}/${s.nr} | ${s.run}/${s.fail} | ${s.da}/${s.td} | ${P(s.H)} | ${P(s.I)} | ${SL[s.st]}`)].join('\n');
}

/* ============ EXPORT EXCEL / CSV ============ */
function sheets(ds) {
  const S = { 'Daily Summary': [], 'Worker Monitoring': [], 'Pod Monitoring': [], 'Deployment Health': [] };
  ds.forEach(d => {
    const s = sm(DB[d]), t = fd(d);
    S['Daily Summary'].push({ Tanggal: t, Environment: DB[d].environment || ENV, 'Worker Ready': s.ready, 'Worker Not Ready': s.nr, 'Running Pod': s.run, 'Failed Pod': s.fail, 'Deployment Available': `${s.da}/${s.td}`, 'Worker CPU Tertinggi (%)': P(s.H), 'Worker Memory Tertinggi (%)': P(s.I), 'Pods CPU Tertinggi (%)': s.pc, 'Pods Memory Tertinggi (%)': s.pm, 'Overall Status': SL[s.st] });
    s.w.forEach(x => S['Worker Monitoring'].push({ Tanggal: t, 'Worker IP': x.ip, Status: x.status, 'CPU %': P(x.cpu), 'Memory %': P(x.mem), 'Disk %': P(x.disk), Remark: SL[rm(x)] }));
    s.p.forEach(x => S['Pod Monitoring'].push({ Tanggal: t, 'Pod Name': x.name, Node: x.node, Namespace: x.ns, Status: x.status, 'Restart Count': x.restarts, CPU: x.cpu, Memory: x.mem, Age: x.age }));
    s.d.forEach(x => S['Deployment Health'].push({ Tanggal: t, Deployment: x.name, Ready: x.ready, Available: x.avail, Age: x.age }));
  });
  return S;
}
$('exGo').onclick = () => {
  const fmt = document.querySelector('[name=xf]:checked').value, rg = document.querySelector('[name=xr]:checked').value, d = $('exDate').value;
  if (!d) return toast('Pilih tanggal acuan', 'danger');
  const ds = dates().filter(x => rg === 'd' ? x === d : x.startsWith(d.slice(0, 7)));
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
$('mEx').addEventListener('show.bs.modal', () => { $('exDate').value = cur || today(); });
$('cmOk').onclick = () => { bootstrap.Modal.getOrCreateInstance($('mCf')).hide(); const f = cfm; cfm = null; f && f(); };
$('tb1').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b || !ref) return;
  const d = b.dataset.del;
  ask(`Apakah Anda yakin ingin menghapus data tanggal ${fd(d)}?`, () => ref.child(d).remove().then(() => toast('Data dihapus')));
});

/* ============ BACKUP & RESTORE JSON ============ */
$('bkExp').onclick = e => { e.preventDefault(); dl(new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' }), `k8s_backup_${today()}.json`); };
$('bkImp').onclick = e => { e.preventDefault(); $('bkFile').click(); };
$('bkFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const o = JSON.parse(rd.result);
      if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.keys(o).every(k => /^\d{4}-\d{2}-\d{2}$/.test(k))) throw 0;
      ask(`Import ${Object.keys(o).length} data harian? Data cloud saat ini akan ditimpa.`, () => ref.set(o).then(() => toast('Backup berhasil diimport')));
    } catch (x) { toast('File backup tidak valid', 'danger'); }
    e.target.value = '';
  };
  rd.readAsText(f);
};
$('rst').onclick = e => { e.preventDefault(); ask('Hapus SEMUA data monitoring dari cloud? Tindakan ini tidak dapat dibatalkan.', () => ref && ref.remove().then(() => toast('Semua data direset'))); };

render();
