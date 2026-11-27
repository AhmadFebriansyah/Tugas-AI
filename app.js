'use strict';
/* =========================================================
   Inquiry Tracker — ekspor & institusi
   Data disimpan di localStorage browser (per perangkat).
   ========================================================= */

const STORE_KEY = 'inquiry-tracker-v1';
const STATUS = ['Baru', 'Penawaran Dikirim', 'Negosiasi', 'Deal', 'Batal'];
const OPEN_STATUS = ['Baru', 'Penawaran Dikirim', 'Negosiasi'];
const URGENT_RE = /sebelum akhir bulan|segera|urgent|asap|secepatnya|deadline/i;

// GANTI dengan daftar harga & MOQ resmi (bisa juga lewat menu Master Produk)
const PRODUK_DEFAULT = [
  { nama: 'Kola-Kola',       harga: 96000,  moqEkspor: 300, moqInstitusi: 25 },
  { nama: 'Nutrijell',       harga: 120000, moqEkspor: 200, moqInstitusi: 20 },
  { nama: 'Blossom Ginger',  harga: 150000, moqEkspor: 500, moqInstitusi: 20 },
  { nama: 'Pop Ice',         harga: 85000,  moqEkspor: 300, moqInstitusi: 30 },
  { nama: 'Anget Sari Jahe', harga: 75000,  moqEkspor: 500, moqInstitusi: 20 },
];
const SETTINGS_DEFAULT = {
  kurs: 16000, ppn: 11, followupHari: 3, berlakuHari: 14,
  tier: [{ min: 500, disc: 3 }, { min: 1000, disc: 5 }],
};

const SEED_TSV = `Tgl Masuk	Nama Buyer	Kota/Negara	Channel	Produk	Qty (Karton)	Sumber	Catatan
24/11/2026	Hotel Grand Pelita	Bandung	Institusi	Kola-Kola	30	Email
03/11/2026	Desert Rose Supermarket	Uni Emirat Arab	Ekspor	Nutrijell	800	Email	Tanya diskon untuk order rutin
14/11/2026	RS Medika Utama (kantin)	Surabaya	Institusi	Kola-Kola	20	Email	Butuh kirim sebelum akhir bulan
08/11/2026	Al Noor Foodstuff Trading LLC	Uni Emirat Arab	Ekspor	Blossom Ginger	800	Pameran	Order pertama, minta MOQ lebih kecil
04/11/2026	Kantin Kampus Nusantara	Yogyakarta	Institusi	Nutrijell	20	WhatsApp
02/11/2026	Oman Fresh Imports	Oman	Ekspor	Pop Ice	100	WhatsApp	Butuh kirim sebelum akhir bulan
07/11/2026	Oman Fresh Imports	Oman	Ekspor	Anget Sari Jahe	1000	Pameran	Butuh kirim sebelum akhir bulan
24/11/2026	Desert Rose Supermarket	Uni Emirat Arab	Ekspor	Nutrijell	100	Email	Minta katalog
15/11/2026	Al Noor Foodstuff Trading LLC	Uni Emirat Arab	Ekspor	Nutrijell	200	WhatsApp	Minta katalog
11/11/2026	Gulf Bites Distribution	Arab Saudi	Ekspor	Kola-Kola	200	WhatsApp	Minta harga dan sample
11/11/2026	Katering Sehat Bersama	Jakarta	Institusi	Anget Sari Jahe	10	Pameran
17/11/2026	Katering Sehat Bersama	Jakarta	Institusi	Blossom Ginger	20	WhatsApp	Minta harga dan sample
25/11/2026	Hotel Grand Pelita	Bandung	Institusi	Anget Sari Jahe	10	Email	Minta harga dan sample
14/11/2026	Kantin Kampus Nusantara	Yogyakarta	Institusi	Kola-Kola	30	Email
07/11/2026	Al Noor Foodstuff Trading LLC	Uni Emirat Arab	Ekspor	Kola-Kola	800	WhatsApp	Tanya umur simpan
16/11/2026	Desert Rose Supermarket	Uni Emirat Arab	Ekspor	Anget Sari Jahe	1000	WhatsApp	Tanya diskon untuk order rutin
05/11/2026	Hotel Grand Pelita	Bandung	Institusi	Kola-Kola	50	Pameran	Minta katalog
04/11/2026	Al Noor Foodstuff Trading LLC	Uni Emirat Arab	Ekspor	Nutrijell	300	Pameran	Tanya diskon untuk order rutin`;

/* ---------------- util ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtRp = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtUsd = (n) => 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Math.round(n).toLocaleString('id-ID');
const shortRp = (n) => n >= 1e9 ? 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M'
  : n >= 1e6 ? 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt' : fmtRp(n);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtTgl = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
}

function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return todayISO();
}

/* ---------------- state ---------------- */
let state;

function load() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage diblokir: tetap jalan di memori */ }
}
function seed() {
  state = { produk: clone(PRODUK_DEFAULT), settings: clone(SETTINGS_DEFAULT), inquiries: [], seq: 0 };
  parseRows(SEED_TSV)
    .map((r, i) => ({ ...r, _i: i }))
    .sort((a, b) => a.tgl.localeCompare(b.tgl) || a._i - b._i)
    .forEach(({ _i, ...r }) => addInquiry(r, false));
  save();
}

function addInquiry(r, persist = true) {
  state.seq += 1;
  const id = 'INQ-' + String(state.seq).padStart(3, '0');
  const q = {
    id, tgl: r.tgl, buyer: r.buyer.trim(), kota: r.kota.trim(),
    channel: r.channel === 'Ekspor' ? 'Ekspor' : 'Institusi',
    produk: r.produk, qty: Math.max(0, parseInt(r.qty, 10) || 0),
    sumber: r.sumber || 'Lainnya', catatan: (r.catatan || '').trim(),
    diskonManual: +r.diskonManual || 0, status: 'Baru',
    history: [{ t: r.tgl + 'T09:00:00', status: 'Baru', ket: 'Inquiry masuk via ' + (r.sumber || '-') }],
  };
  state.inquiries.push(q);
  if (persist) save();
  return q;
}

function setStatus(q, status, ket) {
  if (q.status === status && !ket) return;
  q.status = status;
  q.history.push({ t: new Date().toISOString(), status, ket: ket || '' });
  save();
}

/* parse baris TSV dari spreadsheet (dengan / tanpa header) */
function parseRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out = [];
  for (const line of lines) {
    const c = line.split(line.includes('\t') ? '\t' : ';');
    if (/nama buyer|tgl masuk/i.test(line)) continue;
    if (c.length < 6) continue;
    out.push({
      tgl: parseDate(c[0]), buyer: c[1] || '', kota: c[2] || '',
      channel: /ekspor|export/i.test(c[3]) ? 'Ekspor' : 'Institusi',
      produk: matchProduk(c[4]) || (c[4] || '').trim(), qty: String(c[5]).replace(/\D/g, ''),
      sumber: normSumber(c[6]), catatan: c[7] || '',
    });
  }
  return out;
}
function normSumber(s) {
  s = String(s || '');
  if (/wa|whats/i.test(s)) return 'WhatsApp';
  if (/mail/i.test(s)) return 'Email';
  if (/pameran|expo|fair|booth/i.test(s)) return 'Pameran';
  if (/telp|phone|call/i.test(s)) return 'Telepon';
  return s.trim() || 'Lainnya';
}

/* ---------------- logika bisnis ---------------- */
function getProduk(nama) { return state.produk.find((p) => p.nama === nama); }

/** Hitung penawaran + cek MOQ untuk satu inquiry */
function hitung(q) {
  const p = getProduk(q.produk);
  const s = state.settings;
  if (!p) return null;
  const ekspor = q.channel === 'Ekspor';
  const moq = ekspor ? p.moqEkspor : p.moqInstitusi;
  const lolos = q.qty >= moq;
  const tierDisc = s.tier.filter((t) => q.qty >= t.min).reduce((m, t) => Math.max(m, t.disc), 0);
  const disc = Math.min(tierDisc + (+q.diskonManual || 0), 50);
  const subtotal = q.qty * p.harga;
  const potongan = Math.round(subtotal * disc / 100);
  const dpp = subtotal - potongan;
  const pajak = ekspor ? 0 : Math.round(dpp * s.ppn / 100);
  const total = dpp + pajak;
  const nextTier = s.tier.filter((t) => t.min > q.qty).sort((a, b) => a.min - b.min)[0] || null;
  return {
    p, ekspor, moq, lolos, kurang: Math.max(0, moq - q.qty), tierDisc, disc,
    subtotal, potongan, dpp, pajak, total, nextTier,
    usd: ekspor ? total / s.kurs : null, hargaUsd: p.harga / s.kurs,
    totalJikaMoq: !lolos ? moq * p.harga * (1 - disc / 100) * (ekspor ? 1 : 1 + s.ppn / 100) : null,
  };
}

function buyerCounts() {
  const m = {};
  state.inquiries.forEach((q) => (m[q.buyer] = (m[q.buyer] || 0) + 1));
  return m;
}
function lastUpdate(q) { return q.history[q.history.length - 1].t; }
function isOverdue(q) {
  return ['Baru', 'Penawaran Dikirim'].includes(q.status) && daysSince(lastUpdate(q)) > state.settings.followupHari;
}

/** Skor prioritas 0-100 (berbasis aturan) */
function prioritas(q, h, ctx) {
  if (!OPEN_STATUS.includes(q.status) || !h) return { skor: 0, label: '-', cls: '' };
  let s = 40 * (h.total / (ctx.maxTotal || 1));
  if (URGENT_RE.test(q.catatan)) s += 30;
  if (ctx.counts[q.buyer] > 1) s += 15;
  if (h.lolos) s += 15;
  s = Math.round(s);
  return s >= 60 ? { skor: s, label: 'Tinggi', cls: 'hi' } : s >= 35 ? { skor: s, label: 'Sedang', cls: 'mid' } : { skor: s, label: 'Rendah', cls: 'lo' };
}

/** Rekomendasi tindakan otomatis */
function rekomendasi(q, h, ctx) {
  const r = [];
  if (!h) return ['Produk tidak ada di Master Produk — tambahkan dulu.'];
  const c = q.catatan.toLowerCase();
  if (!h.lolos) {
    r.push(`Qty ${q.qty} karton di bawah MOQ ${h.moq}. Tawarkan naik ke ${h.moq} karton (≈ ${h.ekspor ? fmtUsd(h.totalJikaMoq / state.settings.kurs) : fmtRp(h.totalJikaMoq)}), atau gabungkan dengan produk lain dalam satu pengiriman.`);
  }
  if (/moq lebih kecil/.test(c)) r.push(h.lolos ? 'Buyer minta MOQ lebih kecil, padahal qty sudah memenuhi MOQ — konfirmasi qty final.' : 'Buyer minta MOQ lebih kecil: pertimbangkan trial order khusus order pertama (butuh persetujuan manajer).');
  if (/akhir bulan|segera|urgent/.test(c)) r.push('Deadline kirim akhir bulan — cek stok & jadwal produksi/kapal hari ini.');
  if (/diskon|rutin/.test(c)) r.push(`Buyer tertarik order rutin — siapkan skema kontrak/diskon berulang.${h.nextTier ? ` Tier berikut: ${h.nextTier.min} karton = diskon ${h.nextTier.disc}%.` : ''}`);
  if (/sample/.test(c)) r.push('Kirim sample + price list bersama penawaran.');
  if (/katalog/.test(c)) r.push('Lampirkan katalog produk.');
  if (/umur simpan|shelf/.test(c)) r.push('Sertakan info shelf life & tanggal produksi.');
  if (/order pertama/.test(c)) r.push('Buyer baru — minta dokumen perusahaan & tentukan term pembayaran (mis. T/T 30% DP).');
  if (ctx.counts[q.buyer] > 1) r.push(`Repeat buyer (${ctx.counts[q.buyer]} inquiry) — pertimbangkan penawaran gabungan.`);
  if (isOverdue(q)) r.push(`Belum ada update ${daysSince(lastUpdate(q))} hari — segera follow-up.`);
  if (q.status === 'Baru') r.push('Kirim penawaran lalu ubah status ke "Penawaran Dikirim".');
  return r;
}

function context() {
  const counts = buyerCounts();
  const rows = state.inquiries.map((q) => ({ q, h: hitung(q) }));
  const maxTotal = Math.max(1, ...rows.filter((r) => r.h && OPEN_STATUS.includes(r.q.status)).map((r) => r.h.total));
  const ctx = { counts, maxTotal };
  rows.forEach((r) => (r.pr = prioritas(r.q, r.h, ctx)));
  return { rows, ctx };
}

function noPenawaran(q) { return 'Q-' + q.tgl.slice(2, 4) + q.tgl.slice(5, 7) + '-' + q.id.slice(4); }

function teksPenawaran(q, h) {
  const s = state.settings;
  if (!h) return '';
  if (h.ekspor) {
    return `Dear ${q.buyer},

Thank you for your inquiry. Please find our quotation below.

Quotation No : ${noPenawaran(q)}
Product      : ${q.produk}
Quantity     : ${fmtNum(q.qty)} cartons
Unit price   : ${fmtUsd(h.hargaUsd)} / carton (FOB Jakarta)
Discount     : ${h.disc}%
Total        : ${fmtUsd(h.usd)}
MOQ          : ${h.moq} cartons${h.lolos ? '' : ` (your quantity is below MOQ — we suggest ${h.moq} cartons)`}
Validity     : ${s.berlakuHari} days
${/katalog/i.test(q.catatan) ? '\nOur product catalogue is attached.' : ''}${/sample/i.test(q.catatan) ? '\nSamples can be sent upon confirmation.' : ''}
Best regards,
Export Sales Team`;
  }
  return `Yth. ${q.buyer},

Terima kasih atas permintaannya. Berikut penawaran kami:

No. Penawaran : ${noPenawaran(q)}
Produk        : ${q.produk}
Jumlah        : ${fmtNum(q.qty)} karton
Harga satuan  : ${fmtRp(h.p.harga)} / karton
Diskon        : ${h.disc}%
PPN ${s.ppn}%       : ${fmtRp(h.pajak)}
Total         : ${fmtRp(h.total)}
MOQ           : ${h.moq} karton${h.lolos ? '' : ` (jumlah masih di bawah MOQ, kami sarankan ${h.moq} karton)`}
Berlaku       : ${s.berlakuHari} hari

Salam,
Tim Sales Institusi`;
}

/* ---------------- Smart Paste (ekstraksi berbasis aturan) ---------------- */
const PRODUK_ALIAS = [
  [/kola[\s-]?kola|kolakola/i, 'Kola-Kola'],
  [/nutri[\s-]?jel+/i, 'Nutrijell'],
  [/blossom|ginger drink/i, 'Blossom Ginger'],
  [/pop[\s-]?ice/i, 'Pop Ice'],
  [/anget|sari jahe|jahe/i, 'Anget Sari Jahe'],
];
function matchProduk(text) {
  for (const p of state?.produk || PRODUK_DEFAULT) if (new RegExp(p.nama.replace(/[-\s]/g, '[\\s-]?'), 'i').test(text)) return p.nama;
  for (const [re, nama] of PRODUK_ALIAS) if (re.test(text)) return nama;
  return null;
}
const NEGARA = [
  [/uae|emirat|dubai|abu dhabi|sharjah/i, 'Uni Emirat Arab'],
  [/saudi|riyadh|jeddah|ksa/i, 'Arab Saudi'],
  [/oman|muscat/i, 'Oman'],
  [/qatar|doha/i, 'Qatar'],
  [/kuwait/i, 'Kuwait'],
  [/bahrain/i, 'Bahrain'],
  [/malaysia|kuala lumpur/i, 'Malaysia'],
  [/singapore|singapura/i, 'Singapura'],
];
const KOTA = ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Semarang', 'Medan', 'Makassar', 'Bekasi', 'Tangerang', 'Depok', 'Bogor', 'Malang', 'Solo', 'Denpasar', 'Palembang'];

function smartParse(text) {
  const out = {}; const found = [];
  const produk = matchProduk(text);
  if (produk) { out.produk = produk; found.push('produk'); }
  const qm = text.match(/(\d[\d.,]*)\s*(karton|ktn|ctn|cartons?|dus|box(es)?|cases?)/i) || text.match(/(?:qty|jumlah|quantity)\D{0,5}(\d[\d.,]*)/i);
  if (qm) { out.qty = qm[1].replace(/[.,]/g, ''); found.push('qty'); }
  const neg = NEGARA.find(([re]) => re.test(text));
  if (neg) { out.kota = neg[1]; out.channel = 'Ekspor'; found.push('negara'); }
  else {
    const k = KOTA.find((k) => new RegExp('\\b' + k + '\\b', 'i').test(text) || (k === 'Yogyakarta' && /jogja|yogya/i.test(text)));
    if (k) { out.kota = k; out.channel = 'Institusi'; found.push('kota'); }
  }
  if (!out.channel && /[a-z]{3,}\s+(llc|fze|trading|imports?)\b/i.test(text)) out.channel = 'Ekspor';
  // buyer: kenali yang sudah pernah ada, lalu pola nama perusahaan
  const known = [...new Set(state.inquiries.map((q) => q.buyer))].find((b) => text.toLowerCase().includes(b.toLowerCase()));
  let buyer = known;
  if (!buyer) {
    const m = text.match(/\b((?:PT|CV|RS|Hotel|Katering|Catering|Kantin|Toko|Restoran)\.?\s+[A-Z][\w&.-]*(?:\s+[A-Z][\w&.()-]*){0,4})/)
      || text.match(/\b([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*){0,4}\s+(?:LLC|FZE|FZCO|Trading|Imports?|Distribution|Supermarket|Foodstuff|Co\.?|Ltd\.?|Group))\b/)
      || text.match(/(?:dari|from|kami)\s+([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*){0,4})/);
    if (m) buyer = m[1].trim();
    if (buyer && out.kota) buyer = buyer.replace(new RegExp('\\s+' + out.kota + '$', 'i'), '');
  }
  if (buyer) {
    out.buyer = buyer; found.push('buyer');
    const prev = state.inquiries.find((q) => q.buyer === buyer);
    if (prev) { out.kota = out.kota || prev.kota; out.channel = out.channel || prev.channel; }
  }
  out.sumber = /^(from|subject|dari|kepada|to)\s*:/im.test(text) || /dear|regards|hormat kami/i.test(text) ? 'Email' : 'WhatsApp';
  const notes = [];
  if (/sebelum akhir bulan|end of (the )?month/i.test(text)) notes.push('Butuh kirim sebelum akhir bulan');
  if (/sample|contoh/i.test(text)) notes.push('Minta sample');
  if (/harga|price|quotation|penawaran/i.test(text)) notes.push('Minta harga');
  if (/katalog|catalog/i.test(text)) notes.push('Minta katalog');
  if (/diskon|discount/i.test(text)) notes.push('Tanya diskon' + (/rutin|regular|routine|repeat/i.test(text) ? ' untuk order rutin' : ''));
  if (/umur simpan|shelf/i.test(text)) notes.push('Tanya umur simpan');
  if (/moq|minimum order/i.test(text) && /kecil|lower|smaller|reduce/i.test(text)) notes.push('Minta MOQ lebih kecil');
  if (/pertama|first order/i.test(text)) notes.push('Order pertama');
  if (notes.length) out.catatan = notes.join(', ');
  return { out, found };
}

/* ---------------- render: dashboard ---------------- */
const charts = {};
const chartData = {};

function filteredRows() {
  const ch = $('#fChannel').value, pr = $('#fProduk').value, st = $('#fStatus').value;
  return context().rows.filter(({ q }) => (!ch || q.channel === ch) && (!pr || q.produk === pr) && (!st || q.status === st));
}

function renderDashboard() {
  const rows = filteredRows();
  const all = state.inquiries.length;
  $('#fInfo').textContent = rows.length === all ? `${all} inquiry` : `${rows.length} dari ${all} inquiry`;

  const valid = rows.filter((r) => r.h);
  const open = valid.filter((r) => OPEN_STATUS.includes(r.q.status));
  const totalNilai = valid.filter((r) => r.q.status !== 'Batal').reduce((s, r) => s + r.h.total, 0);
  const totalUsd = valid.filter((r) => r.h.ekspor && r.q.status !== 'Batal').reduce((s, r) => s + r.h.usd, 0);
  const lolos = valid.filter((r) => r.h.lolos).length;
  const deal = rows.filter((r) => r.q.status === 'Deal').length;
  const closed = rows.filter((r) => ['Deal', 'Batal'].includes(r.q.status)).length;
  const overdue = rows.filter((r) => isOverdue(r.q)).length;
  const urgent = open.filter((r) => URGENT_RE.test(r.q.catatan)).length;

  $('#kpis').innerHTML = [
    ['Total inquiry', fmtNum(rows.length), `${open.length} masih terbuka`],
    ['Nilai penawaran', shortRp(totalNilai), `ekspor ${fmtUsd(totalUsd)}`],
    ['Lolos MOQ', valid.length ? Math.round(lolos / valid.length * 100) + '%' : '-', `${valid.length - lolos} inquiry di bawah MOQ`],
    ['Deal rate', closed ? Math.round(deal / closed * 100) + '%' : '-', `${deal} deal dari ${closed} selesai`],
    ['Perlu follow-up', fmtNum(overdue), `${urgent} urgent (deadline)`],
  ].map(([l, v, s]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');

  // butuh tindakan
  const act = open.slice().sort((a, b) => b.pr.skor - a.pr.skor).slice(0, 6);
  $('#actionList').innerHTML = act.length ? act.map(({ q, h, pr }) => {
    const reco = rekomendasi(q, h, context().ctx)[0];
    return `<div class="action" data-id="${q.id}">
      <span class="badge ${pr.cls}">${pr.label}</span>
      <div><div class="a-title">${esc(q.buyer)} · ${esc(q.produk)} ${fmtNum(q.qty)} krt</div><div class="a-meta">${esc(reco)}</div></div>
      <div class="num">${h.ekspor ? fmtUsd(h.usd) : shortRp(h.total)}<span class="sub">${statusDot(q.status)}</span></div>
    </div>`;
  }).join('') : '<div class="empty">Tidak ada inquiry terbuka.</div>';

  // top buyer
  const byBuyer = {};
  valid.forEach(({ q, h }) => {
    const b = (byBuyer[q.buyer] ||= { buyer: q.buyer, kota: q.kota, channel: q.channel, n: 0, qty: 0, nilai: 0 });
    b.n++; b.qty += q.qty; b.nilai += h.total;
  });
  const tb = Object.values(byBuyer).sort((a, b) => b.nilai - a.nilai).slice(0, 6);
  $('#topBuyer').innerHTML = `<div class="table-wrap"><table class="tbl mini"><thead><tr><th>Buyer</th><th>Channel</th><th class="num">Inquiry</th><th class="num">Qty</th><th class="num">Nilai</th></tr></thead><tbody>${
    tb.map((b) => `<tr><td>${esc(b.buyer)}<span class="sub">${esc(b.kota)}</span></td><td>${b.channel}</td><td class="num">${b.n}${b.n > 1 ? ' <span class="badge info">repeat</span>' : ''}</td><td class="num">${fmtNum(b.qty)}</td><td class="num">${shortRp(b.nilai)}</td></tr>`).join('')}</tbody></table></div>`;

  renderCharts(rows);
}

function statusDot(s) {
  const c = { Baru: 'var(--muted)', 'Penawaran Dikirim': 'var(--series-1)', Negosiasi: 'var(--warning)', Deal: 'var(--good)', Batal: 'var(--critical)' }[s];
  return `<span class="st"><i style="background:${c}"></i>${s}</span>`;
}

function countBy(rows, key) {
  const m = {}; rows.forEach((r) => (m[key(r)] = (m[key(r)] || 0) + 1)); return m;
}

function baseOpts(extra = {}) {
  const muted = cssVar('--muted'), grid = cssVar('--grid'), text = cssVar('--text');
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: 'nearest', intersect: true },
    plugins: {
      legend: { display: false, labels: { color: cssVar('--text-2'), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
      tooltip: { backgroundColor: cssVar('--surface'), titleColor: text, bodyColor: text, borderColor: cssVar('--axis'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true },
    },
    scales: {
      x: { grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: muted } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, precision: 0 }, beginAtZero: true },
    },
    ...extra,
  };
}

function mkChart(id, config, table) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
  chartData[id] = table;
  const box = $('#t-' + id);
  if (box.classList.contains('show')) box.innerHTML = tableHtml(table);
}
function tableHtml({ head, rows }) {
  return `<table class="tbl mini"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderCharts(rows) {
  if (typeof Chart === 'undefined') {
    $$('.chart-box').forEach((b) => (b.innerHTML = '<div class="empty">Grafik butuh koneksi internet (Chart.js). Gunakan tombol Tabel.</div>'));
  }
  const S = [1, 2, 3, 4, 5].map((i) => cssVar('--series-' + i));
  const surface = cssVar('--surface');
  const chColor = { Ekspor: S[0], Institusi: S[1] };
  const valid = rows.filter((r) => r.h);
  const produkNames = state.produk.map((p) => p.nama);
  const safe = (fn) => { try { if (typeof Chart !== 'undefined') fn(); } catch (e) { console.error(e); } };

  // 1. channel (donut, 2 bagian)
  const ch = countBy(rows, (r) => r.q.channel);
  const chLabels = ['Ekspor', 'Institusi'];
  safe(() => mkChart('cChannel', {
    type: 'doughnut',
    data: { labels: chLabels.map((l) => `${l} (${ch[l] || 0})`), datasets: [{ data: chLabels.map((l) => ch[l] || 0), backgroundColor: chLabels.map((l) => chColor[l]), borderColor: surface, borderWidth: 2, borderRadius: 4 }] },
    options: { ...baseOpts(), cutout: '62%', scales: {}, plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: true, position: 'bottom' } } },
  }, { head: ['Channel', 'Inquiry'], rows: chLabels.map((l) => [l, ch[l] || 0]) }));

  // 2. sumber (satu seri)
  const src = countBy(rows, (r) => r.q.sumber);
  const srcL = Object.keys(src).sort((a, b) => src[b] - src[a]);
  safe(() => mkChart('cSumber', {
    type: 'bar',
    data: { labels: srcL, datasets: [{ label: 'Inquiry', data: srcL.map((l) => src[l]), backgroundColor: S[0], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44 }] },
    options: baseOpts(),
  }, { head: ['Sumber', 'Inquiry'], rows: srcL.map((l) => [l, src[l]]) }));

  // 3. nilai per produk, stacked per channel
  const nilai = (pn, c) => valid.filter((r) => r.q.produk === pn && r.q.channel === c && r.q.status !== 'Batal').reduce((s, r) => s + r.h.total, 0);
  safe(() => mkChart('cNilai', {
    type: 'bar',
    data: {
      labels: produkNames,
      datasets: chLabels.map((c) => ({ label: c, data: produkNames.map((pn) => nilai(pn, c)), backgroundColor: chColor[c], borderColor: surface, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 30 })),
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: true, position: 'top', align: 'end' }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtRp(c.raw)}` } } },
      scales: {
        x: { stacked: true, grid: { color: cssVar('--grid') }, border: { display: false }, ticks: { color: cssVar('--muted'), maxRotation: 0, maxTicksLimit: 6, callback: (v) => shortRp(v) }, beginAtZero: true },
        y: { stacked: true, grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: cssVar('--text-2') } },
      },
    }),
  }, { head: ['Produk', 'Ekspor', 'Institusi', 'Total'], rows: produkNames.map((pn) => [pn, fmtRp(nilai(pn, 'Ekspor')), fmtRp(nilai(pn, 'Institusi')), fmtRp(nilai(pn, 'Ekspor') + nilai(pn, 'Institusi'))]) }));

  // 4. MOQ per produk (status: lolos / di bawah)
  const moqCnt = (pn, ok) => valid.filter((r) => r.q.produk === pn && r.h.lolos === ok).length;
  safe(() => mkChart('cMoq', {
    type: 'bar',
    data: {
      labels: produkNames,
      datasets: [
        { label: '✓ Lolos MOQ', data: produkNames.map((pn) => moqCnt(pn, true)), backgroundColor: cssVar('--good'), borderColor: surface, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44 },
        { label: '✕ Di bawah MOQ', data: produkNames.map((pn) => moqCnt(pn, false)), backgroundColor: cssVar('--critical'), borderColor: surface, borderWidth: { bottom: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44 },
      ],
    },
    options: baseOpts({
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: true, position: 'top', align: 'end' } },
      scales: { x: { ...baseOpts().scales.x, stacked: true }, y: { ...baseOpts().scales.y, stacked: true } },
    }),
  }, { head: ['Produk', 'MOQ ekspor', 'MOQ institusi', 'Lolos', 'Di bawah'], rows: state.produk.map((p) => [p.nama, p.moqEkspor, p.moqInstitusi, moqCnt(p.nama, true), moqCnt(p.nama, false)]) }));

  // 5. status pipeline (satu seri)
  const st = countBy(rows, (r) => r.q.status);
  safe(() => mkChart('cStatus', {
    type: 'bar',
    data: { labels: STATUS, datasets: [{ label: 'Inquiry', data: STATUS.map((s) => st[s] || 0), backgroundColor: S[0], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
    options: baseOpts({
      indexAxis: 'y',
      scales: {
        x: { grid: { color: cssVar('--grid') }, border: { display: false }, ticks: { color: cssVar('--muted'), precision: 0 }, beginAtZero: true },
        y: { grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: cssVar('--text-2') } },
      },
    }),
  }, { head: ['Status', 'Inquiry'], rows: STATUS.map((s) => [s, st[s] || 0]) }));

  // 6. ekspor per negara (USD)
  const neg = {};
  valid.filter((r) => r.h.ekspor && r.q.status !== 'Batal').forEach((r) => (neg[r.q.kota] = (neg[r.q.kota] || 0) + r.h.usd));
  const negL = Object.keys(neg).sort((a, b) => neg[b] - neg[a]);
  safe(() => mkChart('cNegara', {
    type: 'bar',
    data: { labels: negL, datasets: [{ label: 'Nilai', data: negL.map((l) => Math.round(neg[l])), backgroundColor: S[0], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44 }] },
    options: baseOpts({
      plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ' ' + fmtUsd(c.raw) } } },
      scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: cssVar('--muted'), callback: (v) => 'USD ' + (v >= 1000 ? v / 1000 + 'k' : v) } } },
    }),
  }, { head: ['Negara', 'Nilai (USD)'], rows: negL.map((l) => [l, fmtUsd(neg[l])]) }));

  // 7. tren harian (stacked per channel)
  const dates = rows.map((r) => r.q.tgl).sort();
  const days = [];
  if (dates.length) {
    for (let d = new Date(dates[0]); d <= new Date(dates[dates.length - 1]); d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
  }
  const perDay = (d, c) => rows.filter((r) => r.q.tgl === d && r.q.channel === c).length;
  safe(() => mkChart('cTren', {
    type: 'bar',
    data: {
      labels: days.map((d) => d.slice(8) + '/' + d.slice(5, 7)),
      datasets: chLabels.map((c) => ({ label: c, data: days.map((d) => perDay(d, c)), backgroundColor: chColor[c], borderColor: surface, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 })),
    },
    options: baseOpts({
      interaction: { mode: 'index', intersect: false },
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: true, position: 'top', align: 'end' } },
      scales: { x: { ...baseOpts().scales.x, stacked: true }, y: { ...baseOpts().scales.y, stacked: true } },
    }),
  }, { head: ['Tanggal', 'Ekspor', 'Institusi'], rows: days.filter((d) => perDay(d, 'Ekspor') + perDay(d, 'Institusi')).map((d) => [fmtTgl(d), perDay(d, 'Ekspor'), perDay(d, 'Institusi')]) }));
}

/* ---------------- render: daftar inquiry ---------------- */
function renderList() {
  const term = $('#q').value.trim().toLowerCase();
  const ch = $('#lChannel').value, st = $('#lStatus').value, mq = $('#lMoq').value, sort = $('#lSort').value;
  const { rows } = context();
  let list = rows.filter(({ q, h }) =>
    (!term || [q.id, q.buyer, q.kota, q.produk, q.catatan, q.sumber].join(' ').toLowerCase().includes(term)) &&
    (!ch || q.channel === ch) && (!st || q.status === st) &&
    (!mq || (h && (mq === 'ok' ? h.lolos : !h.lolos))));
  const sorters = {
    prio: (a, b) => b.pr.skor - a.pr.skor || b.q.tgl.localeCompare(a.q.tgl),
    tgl: (a, b) => b.q.tgl.localeCompare(a.q.tgl) || b.q.id.localeCompare(a.q.id),
    nilai: (a, b) => (b.h?.total || 0) - (a.h?.total || 0),
  };
  list.sort(sorters[sort]);

  $('#inqTable').innerHTML = `<thead><tr><th>ID</th><th>Tgl</th><th>Buyer</th><th>Channel</th><th>Produk</th><th class="num">Qty</th><th>MOQ</th><th class="num">Total penawaran</th><th>Prioritas</th><th>Status</th></tr></thead>
  <tbody>${list.length ? list.map(({ q, h, pr }) => `<tr class="clickable" data-id="${q.id}">
    <td>${q.id}</td>
    <td>${fmtTgl(q.tgl)}${isOverdue(q) ? `<span class="sub"><span class="badge late">${daysSince(lastUpdate(q))} hr</span></span>` : ''}</td>
    <td>${esc(q.buyer)}<span class="sub">${esc(q.kota)} · ${esc(q.sumber)}</span></td>
    <td>${q.channel}</td>
    <td>${esc(q.produk)}${q.catatan ? `<span class="sub">${esc(q.catatan)}</span>` : ''}</td>
    <td class="num">${fmtNum(q.qty)}</td>
    <td>${h ? (h.lolos ? `<span class="badge ok">Lolos (${h.moq})</span>` : `<span class="badge no">Kurang ${h.kurang}</span>`) : '-'}</td>
    <td class="num">${h ? (h.ekspor ? fmtUsd(h.usd) + `<span class="sub">${shortRp(h.total)}</span>` : fmtRp(h.total)) : '-'}${h && h.disc ? `<span class="sub">diskon ${h.disc}%</span>` : ''}</td>
    <td>${pr.label === '-' ? '<span class="muted">-</span>' : `<span class="badge ${pr.cls}">${pr.label} ${pr.skor}</span>`}</td>
    <td><select class="stSel" data-id="${q.id}" aria-label="Status ${q.id}">${STATUS.map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
  </tr>`).join('') : '<tr><td colspan="10" class="empty">Tidak ada inquiry yang cocok.</td></tr>'}</tbody>`;
}

/* ---------------- detail modal ---------------- */
function openDetail(id) {
  const q = state.inquiries.find((x) => x.id === id);
  if (!q) return;
  const { ctx } = context();
  const h = hitung(q);
  const pr = prioritas(q, h, ctx);
  const reco = rekomendasi(q, h, ctx);
  const s = state.settings;
  $('#modalBody').innerHTML = `
    <div class="m-head"><h2>${esc(q.buyer)}</h2><span class="muted">${q.id} · ${fmtTgl(q.tgl)}</span> ${statusDot(q.status)} ${pr.label !== '-' ? `<span class="badge ${pr.cls}">Prioritas ${pr.label}</span>` : ''}</div>
    <div class="muted">${esc(q.kota)} · ${q.channel} · via ${esc(q.sumber)}</div>
    <div class="m-grid">
      <div>
        <div class="form-grid">
          <label>Produk<select id="dProduk">${state.produk.map((p) => `<option ${p.nama === q.produk ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}</select></label>
          <label>Qty (karton)<input type="number" id="dQty" min="1" value="${q.qty}"></label>
          <label>Diskon tambahan (%)<input type="number" id="dDisc" min="0" max="30" step="0.5" value="${q.diskonManual}"></label>
          <label>Channel<select id="dChannel"><option ${q.channel === 'Ekspor' ? 'selected' : ''}>Ekspor</option><option ${q.channel === 'Institusi' ? 'selected' : ''}>Institusi</option></select></label>
          <label class="full">Catatan<textarea id="dCat" rows="2">${esc(q.catatan)}</textarea></label>
        </div>
        <div class="row"><button class="btn ghost sm" id="dSave">Simpan perubahan</button></div>
        <hr>
        <h3>Penawaran ${noPenawaran(q)}</h3>
        ${h ? quoteHtml(q, h) : '<p>Produk tidak ditemukan.</p>'}
      </div>
      <div>
        <h3>Rekomendasi tindakan</h3>
        <ul class="reco">${reco.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <hr>
        <h3>Teks penawaran (${h?.ekspor ? 'English' : 'Indonesia'})</h3>
        <pre class="qtext" id="qtext">${esc(teksPenawaran(q, h))}</pre>
        <div class="row">
          <button class="btn sm" id="dCopy">Salin teks</button>
          <button class="btn ghost sm" id="dPrint">Cetak / PDF</button>
          ${q.status === 'Baru' ? '<button class="btn ghost sm" id="dSent">Tandai penawaran terkirim</button>' : ''}
        </div>
        <hr>
        <h3>Update status</h3>
        <div class="form-grid">
          <label>Status<select id="dStatus">${STATUS.map((x) => `<option ${x === q.status ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Keterangan<input id="dKet" placeholder="mis. buyer minta revisi harga"></label>
        </div>
        <div class="row"><button class="btn sm" id="dStBtn">Simpan status</button><button class="btn danger ghost sm" id="dDel">Hapus inquiry</button></div>
        <hr>
        <h3>Riwayat</h3>
        <ul class="timeline">${q.history.slice().reverse().map((x) => `<li><strong>${x.status}</strong> <span class="muted">· ${fmtTgl(x.t)} ${x.t.slice(11, 16)}</span>${x.ket ? `<br>${esc(x.ket)}` : ''}</li>`).join('')}</ul>
      </div>
    </div>`;
  $('#modal').hidden = false;
  $('#modal').dataset.id = id;

  $('#dSave').onclick = () => {
    q.produk = $('#dProduk').value; q.qty = Math.max(1, parseInt($('#dQty').value, 10) || 1);
    q.diskonManual = Math.max(0, +$('#dDisc').value || 0); q.channel = $('#dChannel').value; q.catatan = $('#dCat').value.trim();
    q.history.push({ t: new Date().toISOString(), status: q.status, ket: `Data diubah: ${q.produk} ${q.qty} krt, diskon tambahan ${q.diskonManual}%` });
    save(); refresh(); openDetail(id); toast('Perubahan disimpan');
  };
  $('#dCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#qtext').textContent); toast('Teks penawaran disalin'); }
    catch { toast('Gagal menyalin — blok teksnya manual'); }
  };
  $('#dPrint').onclick = () => { $('#printArea').innerHTML = printHtml(q, h); window.print(); };
  if ($('#dSent')) $('#dSent').onclick = () => { setStatus(q, 'Penawaran Dikirim', `Penawaran ${noPenawaran(q)} dikirim, berlaku ${s.berlakuHari} hari`); refresh(); openDetail(id); toast('Status: Penawaran Dikirim'); };
  $('#dStBtn').onclick = () => { setStatus(q, $('#dStatus').value, $('#dKet').value.trim()); refresh(); openDetail(id); toast('Status diperbarui'); };
  $('#dDel').onclick = () => {
    if (!confirm(`Hapus ${q.id} (${q.buyer})?`)) return;
    state.inquiries = state.inquiries.filter((x) => x.id !== id); save(); closeModal(); refresh(); toast('Inquiry dihapus');
  };
}

function quoteHtml(q, h) {
  const s = state.settings;
  const moqNote = h.lolos
    ? `<div class="note good"><span class="badge ok">Lolos MOQ</span> Qty ${fmtNum(q.qty)} ≥ MOQ ${h.ekspor ? 'ekspor' : 'institusi'} ${h.moq} karton.</div>`
    : `<div class="note bad"><span class="badge no">Di bawah MOQ</span> Kurang ${fmtNum(h.kurang)} karton dari MOQ ${h.moq}.</div>`;
  return `${moqNote}<table class="quote">
    <tr><td>Harga satuan</td><td>${fmtRp(h.p.harga)}${h.ekspor ? ` (${fmtUsd(h.hargaUsd)})` : ''} / karton</td></tr>
    <tr><td>Subtotal (${fmtNum(q.qty)} krt)</td><td>${fmtRp(h.subtotal)}</td></tr>
    <tr><td>Diskon ${h.disc}% <span class="muted small">(volume ${h.tierDisc}% + tambahan ${q.diskonManual}%)</span></td><td>− ${fmtRp(h.potongan)}</td></tr>
    <tr><td>${h.ekspor ? 'PPN ekspor 0%' : `PPN ${s.ppn}%`}</td><td>${fmtRp(h.pajak)}</td></tr>
    <tr class="total"><td>Total</td><td>${h.ekspor ? fmtUsd(h.usd) + `<div class="muted small">${fmtRp(h.total)} @ kurs ${fmtNum(s.kurs)}</div>` : fmtRp(h.total)}</td></tr>
  </table>${h.nextTier ? `<p class="muted small">Tambah ${fmtNum(h.nextTier.min - q.qty)} karton lagi untuk diskon volume ${h.nextTier.disc}%.</p>` : ''}`;
}

function printHtml(q, h) {
  const s = state.settings;
  const berlaku = new Date(); berlaku.setDate(berlaku.getDate() + s.berlakuHari);
  const cur = (rp) => h.ekspor ? fmtUsd(rp / s.kurs) : fmtRp(rp);
  return `<h2>${h.ekspor ? 'QUOTATION' : 'SURAT PENAWARAN HARGA'}</h2>
  <p>No: ${noPenawaran(q)}<br>Tanggal: ${fmtTgl(todayISO())}<br>Berlaku s/d: ${fmtTgl(berlaku.toISOString())}</p>
  <p>Kepada: <strong>${esc(q.buyer)}</strong><br>${esc(q.kota)}</p>
  <table><tr><th>Produk</th><th>Qty (karton)</th><th>Harga/karton</th><th>Diskon</th><th>Jumlah</th></tr>
  <tr><td>${esc(q.produk)}</td><td>${fmtNum(q.qty)}</td><td>${cur(h.p.harga)}</td><td>${h.disc}%</td><td>${cur(h.dpp)}</td></tr>
  <tr><td colspan="4">${h.ekspor ? 'VAT 0% (export)' : 'PPN ' + s.ppn + '%'}</td><td>${cur(h.pajak)}</td></tr>
  <tr><th colspan="4">TOTAL</th><th>${cur(h.total)}</th></tr></table>
  <p>MOQ: ${h.moq} karton${h.lolos ? '' : ' — jumlah pesanan di bawah MOQ'}.${h.ekspor ? ' Term: FOB Jakarta.' : ''}</p>`;
}

function closeModal() { $('#modal').hidden = true; }

/* ---------------- input form + preview ---------------- */
function formData() {
  const f = $('#inqForm');
  return Object.fromEntries(new FormData(f).entries());
}
function renderPreview() {
  const d = formData();
  const q = { ...d, qty: parseInt(d.qty, 10) || 0, diskonManual: +d.diskonManual || 0, catatan: d.catatan || '', buyer: d.buyer || '', status: 'Baru', history: [{ t: new Date().toISOString() }] };
  const h = hitung(q);
  if (!h || !q.qty) { $('#preview').innerHTML = '<div class="empty">Isi produk &amp; qty untuk melihat hitungan penawaran dan cek MOQ.</div>'; return; }
  const counts = buyerCounts(); if (q.buyer) counts[q.buyer] = (counts[q.buyer] || 0) + 1;
  const reco = rekomendasi(q, h, { counts, maxTotal: 1 }).filter((r) => !/Kirim penawaran lalu/.test(r));
  $('#preview').innerHTML = quoteHtml(q, h) + (reco.length ? `<h3 style="margin-top:12px">Rekomendasi</h3><ul class="reco">${reco.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '');
}

/* ---------------- master produk ---------------- */
function renderProduk() {
  $('#produkTable').innerHTML = `<thead><tr><th>Produk</th><th class="num">Harga / karton (Rp)</th><th class="num">≈ USD</th><th class="num">MOQ ekspor (krt)</th><th class="num">MOQ institusi (krt)</th><th class="num">Inquiry</th><th></th></tr></thead><tbody>${
    state.produk.map((p, i) => `<tr data-i="${i}">
      <td><input class="pNama" value="${esc(p.nama)}"></td>
      <td><input class="pHarga num" type="number" min="0" value="${p.harga}"></td>
      <td class="num muted">${fmtUsd(p.harga / state.settings.kurs)}</td>
      <td><input class="pMoqE num" type="number" min="0" value="${p.moqEkspor}"></td>
      <td><input class="pMoqI num" type="number" min="0" value="${p.moqInstitusi}"></td>
      <td class="num">${state.inquiries.filter((q) => q.produk === p.nama).length}</td>
      <td><button class="link pDel" data-i="${i}">hapus</button></td></tr>`).join('')}</tbody>`;
  const s = state.settings;
  $('#sKurs').value = s.kurs; $('#sPpn').value = s.ppn; $('#sFollow').value = s.followupHari; $('#sValid').value = s.berlakuHari;
  $('#sTier').value = s.tier.map((t) => `${t.min}:${t.disc}`).join(', ');
}
function saveProduk() {
  const rename = [];
  const produk = $$('#produkTable tbody tr').map((tr) => {
    const old = state.produk[+tr.dataset.i]?.nama;
    const nama = $('.pNama', tr).value.trim();
    if (old && nama && old !== nama) rename.push([old, nama]);
    return { nama, harga: +$('.pHarga', tr).value || 0, moqEkspor: +$('.pMoqE', tr).value || 0, moqInstitusi: +$('.pMoqI', tr).value || 0 };
  }).filter((p) => p.nama);
  state.produk = produk;
  rename.forEach(([o, n]) => state.inquiries.forEach((q) => { if (q.produk === o) q.produk = n; }));
  state.settings = {
    kurs: Math.max(1, +$('#sKurs').value || SETTINGS_DEFAULT.kurs),
    ppn: Math.max(0, +$('#sPpn').value || 0),
    followupHari: Math.max(1, +$('#sFollow').value || 3),
    berlakuHari: Math.max(1, +$('#sValid').value || 14),
    tier: $('#sTier').value.split(',').map((x) => x.split(':').map(Number)).filter(([m, d]) => m > 0 && d >= 0).map(([min, disc]) => ({ min, disc })),
  };
  save(); fillSelects(); refresh(); toast('Master produk & aturan disimpan');
}

/* ---------------- CSV export ---------------- */
function exportCsv() {
  const { rows } = context();
  const head = ['ID', 'Tgl Masuk', 'Nama Buyer', 'Kota/Negara', 'Channel', 'Produk', 'Qty', 'Sumber', 'Catatan', 'MOQ', 'Lolos MOQ', 'Diskon %', 'Total Rp', 'Total USD', 'Prioritas', 'Status', 'Update terakhir'];
  const lines = [head].concat(rows.map(({ q, h, pr }) => [q.id, fmtTgl(q.tgl), q.buyer, q.kota, q.channel, q.produk, q.qty, q.sumber, q.catatan,
    h?.moq ?? '', h ? (h.lolos ? 'Ya' : 'Tidak') : '', h?.disc ?? '', h ? Math.round(h.total) : '', h?.usd ? h.usd.toFixed(2) : '', pr.label, q.status, fmtTgl(lastUpdate(q))]));
  const csv = '﻿' + lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `inquiry_${todayISO()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- wiring ---------------- */
function fillSelects() {
  const opts = state.produk.map((p) => `<option>${esc(p.nama)}</option>`).join('');
  const keep = $('#fProduk').value;
  $('#fProduk').innerHTML = '<option value="">Semua</option>' + opts; $('#fProduk').value = keep;
  $('#formProduk').innerHTML = opts;
  const stOpts = '<option value="">Semua</option>' + STATUS.map((s) => `<option>${s}</option>`).join('');
  ['#fStatus', '#lStatus'].forEach((sel) => { const k = $(sel).value; $(sel).innerHTML = stOpts; $(sel).value = k; });
  $('#buyerList').innerHTML = [...new Set(state.inquiries.map((q) => q.buyer))].map((b) => `<option value="${esc(b)}">`).join('');
}

function refresh() {
  const active = $('.tab.active').dataset.tab;
  if (active === 'dashboard') renderDashboard();
  if (active === 'inquiry') renderList();
  if (active === 'produk') renderProduk();
  if (active === 'input') renderPreview();
  fillSelects();
}

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  refresh();
}

function init() {
  state = load();
  if (!state || !Array.isArray(state.inquiries)) seed();
  fillSelects();

  $$('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
  ['#fChannel', '#fProduk', '#fStatus'].forEach((s) => $(s).addEventListener('change', renderDashboard));
  ['#q', '#lChannel', '#lStatus', '#lMoq', '#lSort'].forEach((s) => $(s).addEventListener('input', renderList));

  document.addEventListener('click', (e) => {
    const tblBtn = e.target.closest('[data-table]');
    if (tblBtn) {
      const id = tblBtn.dataset.table, box = $('#t-' + id);
      box.classList.toggle('show');
      box.innerHTML = box.classList.contains('show') && chartData[id] ? tableHtml(chartData[id]) : '';
      tblBtn.textContent = box.classList.contains('show') ? 'Sembunyikan' : 'Tabel';
      return;
    }
    if (e.target.closest('select, input, button')) return;
    const row = e.target.closest('[data-id]');
    if (row && !row.closest('#modal')) openDetail(row.dataset.id);
  });
  $('#inqTable').addEventListener('change', (e) => {
    if (!e.target.classList.contains('stSel')) return;
    const q = state.inquiries.find((x) => x.id === e.target.dataset.id);
    setStatus(q, e.target.value, 'Diubah dari daftar inquiry'); renderList(); toast(`${q.id}: ${q.status}`);
  });
  $('#closeModal').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // form
  const f = $('#inqForm');
  f.tgl.value = todayISO();
  f.addEventListener('input', renderPreview);
  f.buyer.addEventListener('change', () => {
    const prev = state.inquiries.find((q) => q.buyer === f.buyer.value);
    if (prev) { f.kota.value = f.kota.value || prev.kota; f.channel.value = prev.channel; renderPreview(); }
  });
  f.addEventListener('reset', () => setTimeout(() => { f.tgl.value = todayISO(); renderPreview(); }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData();
    if (!getProduk(d.produk)) return toast('Pilih produk');
    const q = addInquiry(d);
    f.reset(); $('#pasteText').value = ''; $('#parseInfo').textContent = '';
    fillSelects(); toast(`${q.id} tersimpan`);
    showTab('inquiry'); openDetail(q.id);
  });
  $('#parseBtn').onclick = () => {
    const text = $('#pasteText').value.trim();
    if (!text) return toast('Tempel teks dulu');
    const { out, found } = smartParse(text);
    Object.entries(out).forEach(([k, v]) => { if (f[k]) f[k].value = v; });
    $('#parseInfo').textContent = found.length ? `Terdeteksi: ${found.join(', ')}. Lengkapi yang kosong.` : 'Tidak ada yang terdeteksi — isi manual.';
    renderPreview();
  };
  $('#importBtn').onclick = () => {
    const rows = parseRows($('#importText').value);
    const bad = rows.filter((r) => !getProduk(r.produk));
    rows.filter((r) => getProduk(r.produk)).forEach((r) => addInquiry(r, false));
    save(); fillSelects();
    $('#importInfo').textContent = `${rows.length - bad.length} baris diimpor${bad.length ? `, ${bad.length} dilewati (produk tidak dikenal)` : ''}.`;
    $('#importText').value = '';
  };

  // produk
  $('#saveProduk').onclick = saveProduk;
  $('#addProduk').onclick = () => { state.produk.push({ nama: 'Produk baru', harga: 0, moqEkspor: 0, moqInstitusi: 0 }); renderProduk(); };
  $('#produkTable').addEventListener('click', (e) => {
    if (!e.target.classList.contains('pDel')) return;
    const p = state.produk[+e.target.dataset.i];
    if (confirm(`Hapus produk ${p.nama}?`)) { state.produk.splice(+e.target.dataset.i, 1); save(); renderProduk(); fillSelects(); }
  });
  $('#resetAll').onclick = () => { if (confirm('Hapus semua perubahan & kembali ke 18 inquiry awal?')) { seed(); fillSelects(); refresh(); toast('Data direset'); } };
  $('#exportBtn').onclick = exportCsv;

  // tema
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  try { applyTheme(localStorage.getItem(STORE_KEY + '-theme')); } catch { }
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = dark ? 'light' : 'dark';
    applyTheme(t); try { localStorage.setItem(STORE_KEY + '-theme', t); } catch { }
    refresh();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);

  const fromHash = () => { const h = location.hash.slice(1); return ['dashboard', 'inquiry', 'input', 'produk'].includes(h) ? h : 'dashboard'; };
  window.addEventListener('hashchange', () => showTab(fromHash()));
  showTab(fromHash());
}

init();
