/**
 * BUDGET CONTROL · Finanzas e Inversiones (v2)
 * - Datos cifrados con AES-GCM (clave derivada de la contraseña con PBKDF2)
 * - Tarjetas de débito y crédito, efectivo, transferencias y GBM
 * - Impuestos, cuentas por cobrar, recurrentes, presupuestos y metas
 */
'use strict';

const LEGACY_KEY = 'fcf1';          // formato anterior (sin cifrar)
const VAULT_KEY = 'bc_vault_v2';    // formato nuevo (cifrado)
const THEME_KEY = 'theme_pref';
const PBKDF2_ITER = 250000;

// Categorías
const INCOME_CATEGORIES = [
  { name: 'Cliente Freelance', icon: '💼', color: '#10b981' },
  { name: 'Iguala Mensual / Retainer', icon: '🔄', color: '#3b82f6' },
  { name: 'Hito de Proyecto', icon: '🎯', color: '#8b5cf6' },
  { name: 'Consultoría / Asesoría', icon: '💡', color: '#06b6d4' },
  { name: 'Dividendos / Rendimientos', icon: '📈', color: '#f59e0b' },
  { name: 'Otros Ingresos', icon: '💵', color: '#14b8a6' }
];

const EXPENSE_CATEGORIES = [
  { name: 'Software, SaaS y Hosting', icon: '💻', color: '#6366f1' },
  { name: 'Equipo y Hardware', icon: '🖥️', color: '#3b82f6' },
  { name: 'Espacio de Trabajo / Renta', icon: '🏠', color: '#ec4899' },
  { name: 'Pago de Impuestos (SAT)', icon: '🏛️', color: '#d97706' },
  { name: 'Impuestos y Contabilidad', icon: '⚖️', color: '#f59e0b' },
  { name: 'Marketing y Dominios', icon: '📣', color: '#8b5cf6' },
  { name: 'Comida y Restaurantes', icon: '🍔', color: '#f43f5e' },
  { name: 'Transporte y Viajes', icon: '🚗', color: '#10b981' },
  { name: 'Salud y Seguros', icon: '❤️', color: '#ef4444' },
  { name: 'Cursos y Educación', icon: '📚', color: '#06b6d4' },
  { name: 'Gastos Personales', icon: '🛍️', color: '#a855f7' },
  { name: 'Otros Gastos', icon: '📦', color: '#64748b' }
];

// Ingresos que normalmente causan impuestos (se marcan por defecto)
const TAXABLE_CATEGORIES = ['Cliente Freelance', 'Iguala Mensual / Retainer', 'Hito de Proyecto', 'Consultoría / Asesoría'];
const TAX_PAY_CATEGORY = 'Pago de Impuestos (SAT)';
const ADJUST_CATEGORY = 'Ajuste';

function defaultState() {
  return {
    v: 2,
    cards: [],        // [{id, name, type:'debit'|'credit', initial, limit, cutDay, payDay, color}]
    cashBase: 0,      // saldo base de efectivo (el saldo real se calcula con los movimientos)
    cashTx: [],       // [{id, ts, k, a, n, d, c, tax?, rec?, inv?}]
    tx: [],           // [{id, ts, k, a, n, d, c, cardId, tax?, rec?, inv?}]
    transfers: [],    // [{id, ts, from, to, a, n, d}]  cuentas: id de tarjeta | 'cash' | 'gbm'
    invested: null,   // capital registrado manualmente en GBM (las transferencias se suman aparte)
    gbmCashBase: 0,   // saldo líquido base en GBM
    fx: 17.42,
    fxd: '2026-09-29',
    stocks: [],       // [{id, t, c, p, lots:[{q,b,d,paid}], sales:[{id,q,price,avg,d,mxn,gain,liquid}]}]
    dividends: [],    // [{id, stockId, t, c, a, mxn, d}]
    snaps: [],        // [{d, t}]
    invoices: [],     // [{id, client, concept, a, issued, due, acct, cat, status, paidDate, txRef}]
    recurring: [],    // [{id, k, a, n, c, acct, freq, next, day, active}]
    budgets: {},      // {categoría: monto mensual}
    goals: [],        // [{id, name, target, saved, due}]
    settings: {
      taxEnabled: false,
      taxRate: 30,
      autoLockMin: 5,
      lockOnHide: false,
      autoFx: true
    }
  };
}

let S = defaultState();
let session = emptySession();
let isAuthenticated = false;
let unlockedSnapshot = null;   // estado tal como se descifró (base para sincronizar)

// Navegación / UI
let currentTab = 'overview';   // overview | bank | cash | gbm | plan | data
let selectedBankCardId = null;
let currentPeriod = 'month';   // month | year | all
let selectedChartMode = 'expenses';
let gbmMarketView = 'all';
let reportMonth = null;
const filters = {};
const expandedStocks = {};

function emptySession() {
  return { key: null, salt: null, iter: PBKDF2_ITER, hint: '', plain: false, pass: null };
}

// ==========================================
// HELPERS
// ==========================================
const $ = id => document.getElementById(id);
const iso = d => {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
const today = () => iso(new Date());
const thisMonth = () => today().substring(0, 7);
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
const escapeHtml = esc;

const fmtMxn = n => {
  const v = num(n);
  const sign = v < 0 ? '-' : '';
  const val = Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${val} MXN`;
};
const fmtShort = n => fmtMxn(n).replace(' MXN', '');
const fmtUsd = n => {
  const v = num(n);
  const sign = v < 0 ? '-' : '';
  const val = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${val} USD`;
};
const fmtCur = (n, c) => c === 'USD' ? fmtUsd(n) : fmtMxn(n);
const fmtPct = n => `${num(n) >= 0 ? '+' : ''}${num(n).toFixed(2)}%`;
const fmtQty = n => num(n).toLocaleString('es-MX', { maximumFractionDigits: 6 });

const fmtDate = d => {
  if (!d) return '—';
  const p = String(d).split('-');
  if (p.length === 3) {
    const dt = new Date(+p[0], +p[1] - 1, +p[2]);
    return dt.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return d;
};
const fmtMonth = ym => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return iso(d).substring(0, 7);
}
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }

function toast(msg, ms = 2800) {
  const wrap = $('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function catInfo(name) {
  return INCOME_CATEGORIES.concat(EXPENSE_CATEGORIES).find(c => c.name === name)
    || (name === ADJUST_CATEGORY ? { icon: '✏️', color: '#64748b' } : { icon: '📌', color: '#64748b' });
}

// ==========================================
// TEMA
// ==========================================
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  const theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}
initTheme();

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  render();
}

// ==========================================
// CIFRADO
// ==========================================
const hasCrypto = !!(window.crypto && window.crypto.subtle && window.isSecureContext !== false);
const te = new TextEncoder();
const td = new TextDecoder();

function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
  return { iv: bufToB64(iv), ct: bufToB64(ct) };
}
async function decryptText(key, ivB64, ctB64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivB64) }, key, b64ToBuf(ctB64));
  return td.decode(pt);
}

function readVault() {
  try { const r = localStorage.getItem(VAULT_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function readLegacy() {
  try { const r = localStorage.getItem(LEGACY_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}

async function createSession(pass, hint) {
  if (hasCrypto) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pass, salt, PBKDF2_ITER);
    session = { key, salt, iter: PBKDF2_ITER, hint, plain: false, pass: null };
  } else {
    session = { key: null, salt: null, iter: 0, hint, plain: true, pass };
  }
}

let saveChain = Promise.resolve();
function persist() {
  const json = JSON.stringify(S);
  const sess = Object.assign({}, session);
  if (!sess.key && !sess.plain) return saveChain;
  // Datos de sincronización (versión en la nube, cambios pendientes de subir)
  const cloudOn = typeof cloudActive === 'function' && cloudActive();
  const meta = cloudOn ? cloudVaultMeta() : null;
  saveChain = saveChain.then(async () => {
    let vault;
    if (sess.plain) {
      vault = { v: 2, plain: true, pass: sess.pass, hint: sess.hint, data: json };
    } else {
      const { iv, ct } = await encryptText(sess.key, json);
      vault = { v: 2, enc: true, salt: bufToB64(sess.salt), iter: sess.iter, iv, ct, hint: sess.hint };
    }
    if (meta) Object.assign(vault, meta);
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  }).catch(err => {
    console.error('Save error:', err);
    toast('⚠️ No se pudieron guardar los cambios (¿almacenamiento lleno?)', 5000);
  });
  if (cloudOn) cloudSchedule();
  return saveChain;
}

// ==========================================
// NORMALIZACIÓN / MIGRACIÓN DE DATOS
// ==========================================
function normalizeState(raw) {
  raw = (raw && typeof raw === 'object') ? JSON.parse(JSON.stringify(raw)) : {};
  const d = defaultState();
  const st = Object.assign(d, raw);
  st.settings = Object.assign(defaultState().settings, raw.settings || {});
  ['cards', 'cashTx', 'tx', 'transfers', 'stocks', 'dividends', 'snaps', 'invoices', 'recurring', 'goals']
    .forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });
  if (!st.budgets || typeof st.budgets !== 'object' || Array.isArray(st.budgets)) st.budgets = {};

  let tsCounter = 1;
  const fixMove = m => {
    if (!m.id) m.id = uid();
    if (!m.ts) m.ts = tsCounter++;
    m.a = Math.abs(num(m.a));
    m.k = m.k === 'out' ? 'out' : 'in';
    if (!m.d) m.d = today();
    if (m.tax !== undefined) m.tax = num(m.tax);
    return m;
  };

  // Tarjetas: migración desde "budget" inicial
  if (st.cards.length === 0 && raw.budget !== null && raw.budget !== undefined) {
    st.cards = [{ id: 'c_default', name: 'Cuenta Principal', initial: num(raw.budget), color: 'emerald' }];
  }
  st.cards.forEach(c => {
    if (!c.id) c.id = 'c_' + uid();
    c.name = String(c.name || 'Cuenta');
    c.type = c.type === 'credit' ? 'credit' : 'debit';
    c.initial = num(c.initial);
    c.color = c.color || 'emerald';
  });
  const firstCardId = st.cards[0] ? st.cards[0].id : null;

  st.cashTx.forEach(fixMove);

  // Movimientos de banco: los que se registraron como "cash" ya estaban duplicados en cashTx
  st.tx = st.tx.filter(t => t.cardId !== 'cash');
  st.tx.forEach(t => {
    fixMove(t);
    if (!t.cardId) t.cardId = firstCardId;   // movimientos antiguos sin tarjeta → primera tarjeta
  });

  st.transfers.forEach(r => {
    if (!r.id) r.id = uid();
    if (!r.ts) r.ts = tsCounter++;
    r.a = Math.abs(num(r.a));
  });

  // Efectivo: el saldo ahora se calcula con los movimientos (base + entradas - salidas)
  if (raw.cashBase === undefined) {
    const net = st.cashTx.reduce((a, t) => a + (t.k === 'in' ? t.a : -t.a), 0);
    st.cashBase = num(raw.cash) - net;
  }
  st.cashBase = num(st.cashBase);
  delete st.cash;

  // Acciones: migrar a lotes de compra
  st.stocks.forEach(s => {
    if (!s.id) s.id = uid();
    s.t = String(s.t || '').toUpperCase();
    s.c = s.c === 'MXN' ? 'MXN' : 'USD';
    if (!Array.isArray(s.lots)) {
      s.lots = num(s.q) > 0 ? [{ q: num(s.q), b: num(s.b), d: null, paid: 0 }] : [];
    }
    if (!Array.isArray(s.sales)) s.sales = [];
    if (s.p === undefined || s.p === null) s.p = num(s.b);
    s.p = num(s.p);
    delete s.q; delete s.b;
  });

  st.invoices.forEach(i => { if (!i.id) i.id = uid(); i.a = num(i.a); });
  st.recurring.forEach(r => { if (!r.id) r.id = uid(); r.a = num(r.a); if (r.active === undefined) r.active = true; });
  st.goals.forEach(g => { if (!g.id) g.id = uid(); g.target = num(g.target); g.saved = num(g.saved); });

  st.fx = num(st.fx) > 0 ? num(st.fx) : 17.42;
  st.gbmCashBase = num(st.gbmCashBase);
  if (st.invested !== null) st.invested = num(st.invested);

  // Nunca guardar la contraseña dentro de los datos
  delete st.pass;
  delete st.passHint;
  delete st.budget;
  st.v = 2;
  return st;
}

// ==========================================
// CUENTAS Y SALDOS
// ==========================================
function accountName(id) {
  if (id === 'cash') return 'Efectivo';
  if (id === 'gbm') return 'GBM (saldo líquido)';
  const c = S.cards.find(x => x.id === id);
  return c ? c.name : 'Cuenta eliminada';
}
function accountIcon(id) {
  if (id === 'cash') return '💵';
  if (id === 'gbm') return '📈';
  const c = S.cards.find(x => x.id === id);
  return c && c.type === 'credit' ? '💳' : '🏦';
}
function accountOptionsHtml(selected, { cash = true, gbm = false, blank = null } = {}) {
  let html = blank ? `<option value="">${esc(blank)}</option>` : '';
  html += S.cards.map(c => `<option value="${c.id}" ${selected === c.id ? 'selected' : ''}>${accountIcon(c.id)} ${esc(c.name)}</option>`).join('');
  if (cash) html += `<option value="cash" ${selected === 'cash' ? 'selected' : ''}>💵 Dinero en Efectivo</option>`;
  if (gbm) html += `<option value="gbm" ${selected === 'gbm' ? 'selected' : ''}>📈 GBM (saldo líquido)</option>`;
  return html;
}

function transferNet(acct) {
  let n = 0;
  S.transfers.forEach(r => {
    if (r.to === acct) n += num(r.a);
    if (r.from === acct) n -= num(r.a);
  });
  return n;
}

function getCardStats(cardId) {
  const card = S.cards.find(c => c.id === cardId);
  if (!card) return { card: null, initial: 0, in: 0, out: 0, bal: 0, debt: 0, pct: 0, isCredit: false };
  let inn = 0, out = 0;
  S.tx.forEach(t => {
    if (t.cardId !== cardId) return;
    if (t.k === 'in') inn += num(t.a); else out += num(t.a);
  });
  const initial = num(card.initial);
  const tr = transferNet(cardId);
  const bal = initial + inn - out + tr;
  const isCredit = card.type === 'credit';
  const debt = isCredit ? Math.max(0, -bal) : 0;
  const pct = !isCredit && initial > 0 ? ((bal - initial) / initial) * 100 : 0;
  return { card, initial, in: inn, out, tr, bal, debt, pct, isCredit };
}

function getBankStats() {
  let initial = 0, bal = 0, inn = 0, out = 0, debitBal = 0, creditDebt = 0, creditLimit = 0;
  S.cards.forEach(c => {
    const st = getCardStats(c.id);
    bal += st.bal; inn += st.in; out += st.out;
    if (st.isCredit) { creditDebt += st.debt; creditLimit += num(c.limit); }
    else { debitBal += st.bal; initial += st.initial; }
  });
  const pct = initial > 0 ? ((debitBal - initial) / initial) * 100 : 0;
  return { initial, bal, in: inn, out, pct, debitBal, creditDebt, creditLimit };
}

function getCashStats() {
  let inn = 0, out = 0;
  S.cashTx.forEach(t => { if (t.k === 'in') inn += num(t.a); else out += num(t.a); });
  const tr = transferNet('cash');
  return { bal: num(S.cashBase) + inn - out + tr, in: inn, out, tr, count: S.cashTx.length };
}

// ---------- GBM ----------
const stockQty = s => s.lots.reduce((a, l) => a + num(l.q), 0);
const stockCost = s => s.lots.reduce((a, l) => a + num(l.q) * num(l.b), 0);
const stockAvg = s => { const q = stockQty(s); return q > 0 ? stockCost(s) / q : 0; };
const fxMult = c => c === 'USD' ? num(S.fx) : 1;

function gbmLiquid() {
  let liq = num(S.gbmCashBase) + transferNet('gbm');
  S.dividends.forEach(d => { liq += num(d.mxn); });
  S.stocks.forEach(s => {
    s.lots.forEach(l => { liq -= num(l.paid); });
    s.sales.forEach(x => {
      if (x.liquid) liq += num(x.mxn);
      liq -= num(x.paidRemoved);   // costo ya pagado de los títulos vendidos
    });
  });
  return liq;
}

function investedTotal() {
  return num(S.invested) + transferNet('gbm');
}

function getGbmStats() {
  const fx = num(S.fx) || 1;
  let usInvestedUsd = 0, usCurrentValUsd = 0, mxInvestedMxn = 0, mxCurrentValMxn = 0, realizedMxn = 0;
  S.stocks.forEach(s => {
    const q = stockQty(s);
    const cost = stockCost(s);
    const value = q * num(s.p);
    if (s.c === 'USD') { usInvestedUsd += cost; usCurrentValUsd += value; }
    else { mxInvestedMxn += cost; mxCurrentValMxn += value; }
    s.sales.forEach(x => { realizedMxn += num(x.gain) * fxMult(s.c); });
  });
  const usInvestedInMxn = usInvestedUsd * fx;
  const usCurrentValInMxn = usCurrentValUsd * fx;
  const usGainUsd = usCurrentValUsd - usInvestedUsd;
  const usGainPct = usInvestedUsd > 0 ? (usGainUsd / usInvestedUsd) * 100 : 0;
  const mxGainMxn = mxCurrentValMxn - mxInvestedMxn;
  const mxGainPct = mxInvestedMxn > 0 ? (mxGainMxn / mxInvestedMxn) * 100 : 0;
  const liquid = gbmLiquid();
  const stocksValMxn = usCurrentValInMxn + mxCurrentValMxn;
  const totalPortfolioValMxn = stocksValMxn + liquid;
  const totalInvestedMxn = S.invested === null && !S.transfers.some(r => r.to === 'gbm' || r.from === 'gbm')
    ? usInvestedInMxn + mxInvestedMxn
    : investedTotal();
  const totalGainMxn = totalPortfolioValMxn - totalInvestedMxn;
  const totalGainPct = totalInvestedMxn > 0 ? (totalGainMxn / totalInvestedMxn) * 100 : 0;
  const dividendsMxn = S.dividends.reduce((a, d) => a + num(d.mxn), 0);
  return {
    fx, usInvestedUsd, usCurrentValUsd, usInvestedInMxn, usCurrentValInMxn, usGainUsd, usGainPct,
    mxInvestedMxn, mxCurrentValMxn, mxGainMxn, mxGainPct, liquid, stocksValMxn,
    totalInvestedMxn, totalPortfolioValMxn, totalGainMxn, totalGainPct, dividendsMxn, realizedMxn
  };
}

function netWorth() {
  return getBankStats().bal + getCashStats().bal + getGbmStats().totalPortfolioValMxn;
}

// ==========================================
// MOVIMIENTOS (vista unificada)
// ==========================================
function allMovements() {
  const list = [];
  S.tx.forEach(t => list.push({ src: 'tx', id: t.id, ts: t.ts, k: t.k, a: num(t.a), n: t.n, d: t.d, c: t.c, acct: t.cardId, tax: num(t.tax), rec: t.rec, inv: t.inv }));
  S.cashTx.forEach(t => list.push({ src: 'cash', id: t.id, ts: t.ts, k: t.k, a: num(t.a), n: t.n, d: t.d, c: t.c, acct: 'cash', tax: num(t.tax), rec: t.rec, inv: t.inv }));
  S.transfers.forEach(r => list.push({ src: 'tr', id: r.id, ts: r.ts, k: 'tr', a: num(r.a), n: r.n, d: r.d, from: r.from, to: r.to }));
  return list;
}
const sortDesc = (a, b) => (b.d || '').localeCompare(a.d || '') || (num(b.ts) - num(a.ts));
const sortAsc = (a, b) => -sortDesc(a, b);

// Ingresos y gastos reales (sin transferencias ni ajustes de saldo)
function realFlows() {
  return allMovements().filter(m => m.src !== 'tr' && m.c !== ADJUST_CATEGORY);
}

function touchesAcct(m, acct) {
  return m.src === 'tr' ? (m.from === acct || m.to === acct) : m.acct === acct;
}
function signedFor(m, acct) {
  if (m.src === 'tr') return m.to === acct ? m.a : -m.a;
  return m.k === 'in' ? m.a : -m.a;
}

function findMovement(src, id) {
  const arr = src === 'tx' ? S.tx : src === 'cash' ? S.cashTx : S.transfers;
  return arr.find(x => x.id === id) || null;
}

// Agrega un ingreso/gasto en la cuenta indicada (tarjeta o efectivo)
function addMovement({ k, a, n, d, c, acct, tax, rec, inv, id, ts }) {
  const base = { id: id || uid(), ts: ts || Date.now(), k, a: round2(Math.abs(num(a))), n: n || '', d: d || today(), c };
  if (tax) base.tax = num(tax);
  if (rec) base.rec = rec;
  if (inv) base.inv = inv;
  if (acct === 'cash') {
    S.cashTx.push(base);
    return { src: 'cash', id: base.id };
  }
  base.cardId = acct || (S.cards[0] ? S.cards[0].id : null);
  S.tx.push(base);
  return { src: 'tx', id: base.id };
}

function removeMovement(src, id) {
  if (src === 'tx') S.tx = S.tx.filter(t => t.id !== id);
  else if (src === 'cash') S.cashTx = S.cashTx.filter(t => t.id !== id);
  else if (src === 'tr') S.transfers = S.transfers.filter(t => t.id !== id);
}

// ==========================================
// IMPUESTOS
// ==========================================
function defaultTaxFor(cat) {
  return S.settings.taxEnabled && TAXABLE_CATEGORIES.includes(cat) ? num(S.settings.taxRate) : 0;
}
function getTaxStats(year = today().substring(0, 4)) {
  let reserved = 0, paid = 0, monthReserved = 0;
  const ym = thisMonth();
  realFlows().forEach(m => {
    if (!(m.d || '').startsWith(year)) return;
    if (m.k === 'in' && m.tax > 0) {
      const r = m.a * m.tax / 100;
      reserved += r;
      if (m.d.startsWith(ym)) monthReserved += r;
    }
    if (m.k === 'out' && m.c === TAX_PAY_CATEGORY) paid += m.a;
  });
  return { reserved, paid, pending: Math.max(0, reserved - paid), monthReserved, year };
}

// ==========================================
// RECURRENTES
// ==========================================
function advanceDate(dateIso, freq, anchorDay) {
  const d = parseIso(dateIso);
  if (freq === 'weekly') { d.setDate(d.getDate() + 7); return iso(d); }
  if (freq === 'biweekly') { d.setDate(d.getDate() + 14); return iso(d); }
  const day = anchorDay || d.getDate();
  let y = d.getFullYear(), m = d.getMonth();
  if (freq === 'yearly') y += 1; else m += 1;
  if (m > 11) { m = 0; y += 1; }
  return iso(new Date(y, m, Math.min(day, daysInMonth(y, m))));
}

function processRecurring() {
  let created = 0;
  const t = today();
  S.recurring.forEach(r => {
    if (!r.active || !r.next) return;
    let guard = 0;
    while (r.next <= t && guard < 400) {
      // id fijo por fecha: si dos dispositivos generan el mismo pago, no se duplica al sincronizar
      addMovement({ id: `r_${r.id}_${r.next}`, k: r.k, a: r.a, n: r.n, d: r.next, c: r.c, acct: r.acct, rec: r.id, tax: r.k === 'in' ? defaultTaxFor(r.c) : 0 });
      r.next = advanceDate(r.next, r.freq, r.day);
      created++; guard++;
    }
  });
  return created;
}

// ==========================================
// GUARDAR ESTADO
// ==========================================
function saveState() {
  if (!isAuthenticated) return;
  const tot = round2(netWorth());
  const t = today();
  const last = S.snaps[S.snaps.length - 1];
  if (last && last.d === t) last.t = tot;
  else S.snaps.push({ d: t, t: tot });
  if (S.snaps.length > 1500) S.snaps = S.snaps.slice(-1500);
  persist();
}

function getReferenceSnapshot() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const r = iso(d);
  let x = null;
  S.snaps.forEach(n => { if (n.d <= r) x = n; });
  return x || S.snaps[0] || null;
}

// ==========================================
// GRÁFICOS
// ==========================================
function renderDonutChart(dataItems, centerTitle, centerVal) {
  const size = 210, strokeWidth = 26;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = dataItems.reduce((a, b) => a + b.val, 0);

  if (total <= 0 || !dataItems.length) {
    return `
      <div class="donut-container">
        <div class="donut-svg-wrap">
          <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Sin datos">
            <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--card-border)" stroke-width="${strokeWidth}" />
          </svg>
          <div class="donut-center-info">
            <div class="donut-center-label">${esc(centerTitle)}</div>
            <div class="donut-center-val">$0.00</div>
          </div>
        </div>
      </div>`;
  }

  let acc = 0;
  const paths = dataItems.map(item => {
    const pct = item.val / total;
    const dash = `${Math.max(0, pct * circumference - (dataItems.length > 1 ? 2 : 0))} ${circumference}`;
    const off = -acc * circumference;
    acc += pct;
    return `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${item.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" stroke-dashoffset="${off}"><title>${esc(item.name)}: ${fmtMxn(item.val)}</title></circle>`;
  }).join('');

  return `
    <div class="donut-container">
      <div class="donut-svg-wrap">
        <svg viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg);" role="img" aria-label="${esc(centerTitle)}">${paths}</svg>
        <div class="donut-center-info">
          <div class="donut-center-label">${esc(centerTitle)}</div>
          <div class="donut-center-val">${fmtShort(centerVal)}</div>
        </div>
      </div>
    </div>`;
}

let chartSeq = 0;
function renderAreaChart(pts, chartColor = 'var(--primary)', labels = null, emptyMsg = 'Agrega movimientos para ver la curva de balance.') {
  if (pts.length < 2) {
    return `<div class="empty-state"><div class="empty-icon">📊</div>${esc(emptyMsg)}</div>`;
  }
  const gid = 'areaGrad' + (++chartSeq);
  const W = 600, H = 170, pad = 26;
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const range = (mx - mn) || 1;
  const points = pts.map((v, i) => [
    pad + (i * (W - pad * 2)) / (pts.length - 1),
    H - pad - ((v - mn) / range) * (H - pad * 2),
    v
  ]);
  const poly = points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${points[0][0]},${H - pad} ${poly} ${points[points.length - 1][0]},${H - pad}`;
  const showDots = points.length <= 40;
  const first = points[0], last = points[points.length - 1];

  return `
    <div style="margin: 10px 0;">
      <svg viewBox="0 0 ${W} ${H}" style="overflow: visible; width: 100%;" role="img" aria-label="Gráfica de evolución">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${chartColor}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="${chartColor}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--card-border)" stroke-dasharray="4 4"/>
        <line x1="${pad}" y1="${pad}" x2="${W - pad}" y2="${pad}" stroke="var(--card-border)" stroke-dasharray="4 4"/>
        <polygon points="${area}" fill="url(#${gid})"/>
        <polyline fill="none" stroke="${chartColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${poly}"/>
        ${showDots ? points.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--surface)" stroke="${chartColor}" stroke-width="2.5"><title>${fmtMxn(p[2])}</title></circle>`).join('') : ''}
        <text x="${first[0]}" y="${first[1] - 10}" fill="var(--text-main)" font-size="11" font-weight="800" text-anchor="start">${fmtShort(first[2])}</text>
        <text x="${last[0]}" y="${last[1] - 10}" fill="var(--text-main)" font-size="11" font-weight="800" text-anchor="end">${fmtShort(last[2])}</text>
        ${labels ? `
          <text x="${pad}" y="${H - 6}" fill="var(--text-muted)" font-size="10.5" font-weight="700" text-anchor="start">${esc(labels[0])}</text>
          <text x="${W - pad}" y="${H - 6}" fill="var(--text-muted)" font-size="10.5" font-weight="700" text-anchor="end">${esc(labels[1])}</text>
        ` : ''}
      </svg>
    </div>`;
}

function renderBarPerformance(items) {
  if (!items.length) return `<div class="empty-state">No hay posiciones abiertas.</div>`;
  const mx = Math.max(...items.map(i => Math.abs(i.v)), 5);
  const W = 560, rowH = 36, H = items.length * rowH + 10;
  return `
    <div style="overflow-x: auto; margin-top: 10px;">
      <svg viewBox="0 0 ${W} ${H}" style="width: 100%; min-width: 320px;" role="img" aria-label="Rendimiento por acción">
        ${items.map((it, n) => {
          const barW = Math.max(2, Math.min((Math.abs(it.v) / mx) * 300, 320));
          const y = n * rowH + 8;
          const color = it.v >= 0 ? 'var(--income)' : 'var(--expense)';
          return `
            <text x="0" y="${y + 16}" fill="var(--text-main)" font-size="13" font-weight="800">${esc(it.l)}</text>
            <rect x="120" y="${y + 3}" width="${barW}" height="18" rx="6" fill="${color}" opacity="0.9"/>
            <text x="${128 + barW}" y="${y + 16}" fill="var(--text-muted)" font-size="12" font-weight="800">${fmtPct(it.v)}</text>`;
        }).join('')}
      </svg>
    </div>`;
}

// ==========================================
// AGRUPACIONES / REPORTES
// ==========================================
function getCategoryBreakdown(type = 'out') {
  const catMap = {};
  const ym = thisMonth(), yy = today().substring(0, 4);
  realFlows().forEach(m => {
    if (m.k !== type) return;
    if (currentPeriod === 'month' && !(m.d || '').startsWith(ym)) return;
    if (currentPeriod === 'year' && !(m.d || '').startsWith(yy)) return;
    const name = m.c || (type === 'out' ? 'Otros Gastos' : 'Otros Ingresos');
    catMap[name] = (catMap[name] || 0) + m.a;
  });
  const total = Object.values(catMap).reduce((a, b) => a + b, 0);
  const list = Object.keys(catMap).map(name => {
    const info = catInfo(name);
    return { name, icon: info.icon, color: info.color, val: catMap[name], pct: total > 0 ? (catMap[name] / total) * 100 : 0 };
  }).sort((a, b) => b.val - a.val);
  return { list, total };
}

function monthSummary(ym) {
  let income = 0, expense = 0;
  const cats = {};
  realFlows().forEach(m => {
    if (!(m.d || '').startsWith(ym)) return;
    if (m.k === 'in') income += m.a;
    else { expense += m.a; cats[m.c || 'Otros Gastos'] = (cats[m.c || 'Otros Gastos'] || 0) + m.a; }
  });
  const net = income - expense;
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { income, expense, net, rate: income > 0 ? (net / income) * 100 : 0, top };
}

function monthSpentByCategory(ym) {
  const map = {};
  realFlows().forEach(m => {
    if (m.k === 'out' && (m.d || '').startsWith(ym)) map[m.c] = (map[m.c] || 0) + m.a;
  });
  return map;
}

function nextDayOfMonth(day) {
  if (!day) return null;
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  let d = new Date(y, m, Math.min(day, daysInMonth(y, m)));
  if (iso(d) < today()) {
    m += 1; if (m > 11) { m = 0; y += 1; }
    d = new Date(y, m, Math.min(day, daysInMonth(y, m)));
  }
  return iso(d);
}

function getAlerts() {
  const alerts = [];
  const t = today();
  // Facturas vencidas o por vencer
  S.invoices.filter(i => i.status !== 'paid').forEach(i => {
    const days = daysBetween(t, i.due);
    if (days < 0) alerts.push({ lvl: 'bad', icon: '🧾', html: `Factura de <b>${esc(i.client)}</b> por <b>${fmtMxn(i.a)}</b> vencida hace ${-days} día(s).`, act: `setTab('plan')`, btn: 'Ver' });
    else if (days <= 3) alerts.push({ lvl: 'warn', icon: '🧾', html: `Factura de <b>${esc(i.client)}</b> (${fmtMxn(i.a)}) vence ${days === 0 ? 'hoy' : `en ${days} día(s)`}.`, act: `setTab('plan')`, btn: 'Ver' });
  });
  // Pago de tarjetas de crédito
  S.cards.filter(c => c.type === 'credit' && c.payDay).forEach(c => {
    const st = getCardStats(c.id);
    if (st.debt <= 0) return;
    const next = nextDayOfMonth(c.payDay);
    const days = daysBetween(t, next);
    if (days <= 5) alerts.push({ lvl: days <= 2 ? 'bad' : 'warn', icon: '💳', html: `Pago de <b>${esc(c.name)}</b> ${days === 0 ? 'vence hoy' : `vence en ${days} día(s)`} · Deuda ${fmtMxn(st.debt)}.`, act: `openTransferModal(null, '${c.id}')`, btn: 'Pagar' });
  });
  // Presupuestos
  const spent = monthSpentByCategory(thisMonth());
  Object.entries(S.budgets).forEach(([cat, lim]) => {
    lim = num(lim);
    if (lim <= 0) return;
    const s = spent[cat] || 0;
    const pct = s / lim * 100;
    if (pct >= 100) alerts.push({ lvl: 'bad', icon: '🚨', html: `Te pasaste del presupuesto de <b>${esc(cat)}</b>: ${fmtMxn(s)} de ${fmtMxn(lim)} (${pct.toFixed(0)}%).`, act: `setTab('plan')`, btn: 'Ver' });
    else if (pct >= 80) alerts.push({ lvl: 'warn', icon: '⚠️', html: `Llevas ${pct.toFixed(0)}% del presupuesto de <b>${esc(cat)}</b> (${fmtMxn(s)} de ${fmtMxn(lim)}).`, act: `setTab('plan')`, btn: 'Ver' });
  });
  // Saldo líquido de GBM negativo
  if (S.stocks.length && gbmLiquid() < -0.5) {
    alerts.push({ lvl: 'warn', icon: '📈', html: `Tu saldo líquido en GBM es negativo (${fmtMxn(gbmLiquid())}). Registra un depósito o ajústalo.`, act: `setTab('gbm')`, btn: 'Ver' });
  }
  return alerts;
}

// ==========================================
// RENDER PRINCIPAL
// ==========================================
function render() {
  const app = $('app');
  chartSeq = 0;

  if (!isAuthenticated) {
    app.innerHTML = renderLockScreen();
    const inp = $('lockPassInput');
    if (inp) setTimeout(() => inp.focus(), 30);
    return;
  }

  const tabs = [
    ['overview', '📊 Resumen'],
    ['bank', '🏦 Banco & Tarjetas'],
    ['cash', '💵 Efectivo'],
    ['gbm', '📈 Inversiones GBM'],
    ['plan', '🎯 Planeación'],
    ['data', '⚙️ Ajustes & Datos']
  ];

  const headerHtml = `
    <header class="top-header">
      <div class="brand-badge" onclick="setTab('overview')" role="button" tabindex="0" aria-label="Ir al resumen">
        <img src="icon-64.png" alt="" class="header-logo-icon">
        <div>
          <div class="brand-title">Budget Control</div>
          <div class="brand-sub">Finanzas e Inversiones</div>
        </div>
      </div>
      <div class="header-actions">
        ${typeof cloudHeaderBadge === 'function' ? cloudHeaderBadge() : ''}
        <button class="btn-icon" onclick="toggleTheme()" title="Modo claro / oscuro" aria-label="Cambiar tema">🌓</button>
        <button class="btn-icon" onclick="lockSession()" title="Bloquear" aria-label="Bloquear">🔒</button>
        <button class="btn-icon" onclick="openTxModal('in')" title="Agregar ingreso" aria-label="Agregar ingreso" style="color:var(--income); font-weight:800;">＋</button>
        <button class="btn-icon" onclick="openTxModal('out')" title="Agregar gasto" aria-label="Agregar gasto" style="color:var(--expense); font-weight:800;">−</button>
      </div>
    </header>
    <nav class="nav-tab-bar" aria-label="Secciones">
      ${tabs.map(([k, l]) => `<button class="nav-tab-btn ${currentTab === k ? 'active' : ''}" onclick="setTab('${k}')" ${currentTab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}
    </nav>`;

  let tabHtml = '';
  if (currentTab === 'overview') tabHtml = renderOverview();
  else if (currentTab === 'bank') tabHtml = selectedBankCardId ? renderCardDetail() : renderBank();
  else if (currentTab === 'cash') tabHtml = renderCash();
  else if (currentTab === 'gbm') tabHtml = renderGbm();
  else if (currentTab === 'plan') tabHtml = renderPlan();
  else if (currentTab === 'data') tabHtml = renderData();

  app.innerHTML = headerHtml + tabHtml;
}

// ---------- Pantalla de bloqueo ----------
function renderLockScreen() {
  const vault = readVault();
  const legacy = readLegacy();
  const hasPassword = !!vault || !!(legacy && legacy.pass);
  const isMigration = !vault && legacy && legacy.pass;

  return `
    <div class="lock-screen">
      <div class="lock-logo-wrap">
        <img src="logo.png" alt="Budget Control - Finanzas e Inversiones" class="app-logo-img">
      </div>
      <h1 class="grad-title" style="font-size:22px; margin-bottom:6px;">
        ${hasPassword ? 'Bienvenido a Budget Control' : 'Configura tu Contraseña & Pista'}
      </h1>
      <p>
        ${hasPassword
          ? 'Ingresa tu contraseña para acceder a tus cuentas, tarjetas, efectivo y portafolio.'
          : 'Crea una contraseña para cifrar y proteger tu información antes de comenzar.'}
      </p>

      <form class="lock-form" onsubmit="handleAuth(event)">
        <div class="password-input-wrap">
          <label for="lockPassInput" class="hidden">Contraseña</label>
          <input type="password" id="lockPassInput" class="password-input"
            placeholder="${hasPassword ? 'Contraseña' : 'Nueva contraseña (mín. 4 caracteres)'}"
            autocomplete="${hasPassword ? 'current-password' : 'new-password'}" required>
          <button type="button" class="toggle-pass-btn" onclick="togglePassVisibility('lockPassInput', this)" aria-label="Ver u ocultar">👁️</button>
        </div>

        ${!hasPassword ? `
          <div class="password-input-wrap">
            <label for="lockPassConfirm" class="hidden">Confirmar contraseña</label>
            <input type="password" id="lockPassConfirm" class="password-input" placeholder="Confirmar contraseña" autocomplete="new-password" required>
            <button type="button" class="toggle-pass-btn" onclick="togglePassVisibility('lockPassConfirm', this)" aria-label="Ver u ocultar">👁️</button>
          </div>
          <div style="text-align:left; margin-top:2px;">
            <label class="form-label" for="lockPassHint" style="font-size:11.5px; margin-bottom:4px;">Pista para recordar tu contraseña (obligatoria):</label>
            <input type="text" id="lockPassHint" class="input-field" placeholder="Ej. Nombre de mi primera mascota" required maxlength="100" style="font-size:14px;">
            <span class="form-hint">💡 La pista se muestra si olvidas tu contraseña. No escribas la contraseña en ella.</span>
          </div>
        ` : ''}

        <div id="lockErrorMsg" class="lock-error-msg" role="alert"></div>

        <button type="submit" class="btn-submit" id="lockSubmitBtn" style="margin-top:4px;">
          ${hasPassword ? 'Desbloquear e Iniciar 🚀' : 'Establecer Contraseña e Iniciar 🚀'}
        </button>
      </form>

      ${hasPassword ? `
        <div style="margin-top:14px;">
          <button type="button" onclick="showPasswordHintModal()"
            style="background:none; border:none; color:var(--usd-color); font-size:13.5px; font-weight:800; cursor:pointer; text-decoration:underline;">
            💡 ¿Olvidaste tu contraseña? Ver pista
          </button>
        </div>` : ''}

      <div style="margin-top:16px; font-size:11.5px; color:var(--text-muted); font-weight:700;">
        ${hasCrypto ? '🔐 Tus datos se guardan cifrados (AES-256) en este navegador.' : '⚠️ Este navegador no permite cifrado aquí; abre la app desde un archivo local o https.'}
        ${isMigration ? '<br>Al entrar, tus datos actuales se cifrarán automáticamente.' : ''}
      </div>

      <div id="cloudLockSlot">${typeof cloudLockHtml === 'function' ? cloudLockHtml() : ''}</div>

      <div style="margin-top:14px; display:flex; justify-content:center;">
        <button class="btn-icon" onclick="toggleTheme()" title="Modo claro / oscuro" aria-label="Cambiar tema">🌓</button>
      </div>
    </div>`;
}

// ---------- Resumen ----------
function renderOverview() {
  const bank = getBankStats();
  const gbm = getGbmStats();
  const cash = getCashStats();
  const total = bank.bal + gbm.totalPortfolioValMxn + cash.bal;
  const ref = getReferenceSnapshot();
  const delta = ref ? total - ref.t : 0;
  const deltaPct = ref && ref.t ? (delta / Math.abs(ref.t)) * 100 : 0;
  const alerts = getAlerts();

  const exp = getCategoryBreakdown('out');
  const inc = getCategoryBreakdown('in');
  const assets = [
    { name: 'Cuentas de débito / ahorro', icon: '🏦', color: '#0ea5e9', val: Math.max(0, bank.debitBal) },
    { name: 'Dinero en efectivo', icon: '💵', color: '#00b87c', val: Math.max(0, cash.bal) },
    { name: 'Acciones EE.UU. (en MXN)', icon: '🇺🇸', color: '#3b82f6', val: gbm.usCurrentValInMxn },
    { name: 'Acciones México', icon: '🇲🇽', color: '#8b5cf6', val: gbm.mxCurrentValMxn },
    { name: 'Saldo líquido GBM', icon: '📈', color: '#f59e0b', val: Math.max(0, gbm.liquid) }
  ].filter(a => a.val > 0);
  const assetsTotal = assets.reduce((a, b) => a + b.val, 0);
  assets.forEach(a => { a.pct = assetsTotal > 0 ? a.val / assetsTotal * 100 : 0; });

  const chartItems = selectedChartMode === 'expenses' ? exp.list : selectedChartMode === 'income' ? inc.list : assets;
  const chartTotal = selectedChartMode === 'expenses' ? exp.total : selectedChartMode === 'income' ? inc.total : assetsTotal;
  const chartTitle = selectedChartMode === 'expenses' ? 'Gastos' : selectedChartMode === 'income' ? 'Ingresos' : 'Activos';

  const snaps = S.snaps.slice(-180);

  return `
    ${alerts.length ? `<div style="margin-bottom:14px;">${alerts.map(a => `
      <div class="alert-box ${a.lvl}">
        <span>${a.icon}</span><span>${a.html}</span>
        ${a.act ? `<button class="mini-btn" onclick="${a.act}">${a.btn}</button>` : ''}
      </div>`).join('')}</div>` : ''}

    <div class="hero-card">
      <div class="hero-label">Patrimonio Neto Total</div>
      <div class="hero-value">${fmtMxn(total)}</div>
      <div class="hero-badge-row">
        <span class="pill ${delta >= 0 ? 'up' : 'dn'}">${delta >= 0 ? '▲' : '▼'} ${fmtMxn(Math.abs(delta))} (${fmtPct(deltaPct)})</span>
        <span class="pill neutral">vs ${ref ? fmtDate(ref.d) : 'inicio'}</span>
        <span class="pill usd-pill">1 USD = $${num(S.fx).toFixed(4)} MXN</span>
      </div>

      <div class="breakdown-grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">
        <div class="breakdown-item" onclick="setTab('bank')" role="button" tabindex="0">
          <div class="breakdown-header">🏦 Cuentas (${S.cards.filter(c => c.type !== 'credit').length})</div>
          <div class="breakdown-amt">${fmtMxn(bank.debitBal)}</div>
          <span style="font-size:11.5px; color:${bank.pct >= 0 ? 'var(--income)' : 'var(--expense)'}; font-weight:700;">${fmtPct(bank.pct)} vs saldos iniciales</span>
        </div>
        <div class="breakdown-item" onclick="setTab('cash')" role="button" tabindex="0">
          <div class="breakdown-header" style="color:var(--primary);">💵 Efectivo</div>
          <div class="breakdown-amt" style="color:${cash.bal < 0 ? 'var(--expense)' : 'var(--primary)'};">${fmtMxn(cash.bal)}</div>
          <span style="font-size:11.5px; color:var(--text-muted); font-weight:700;">Disponible en mano</span>
        </div>
        <div class="breakdown-item" onclick="setTab('gbm')" role="button" tabindex="0">
          <div class="breakdown-header">📈 Inversiones GBM</div>
          <div class="breakdown-amt">${fmtMxn(gbm.totalPortfolioValMxn)}</div>
          <span style="font-size:11.5px; color:${gbm.totalGainMxn >= 0 ? 'var(--income)' : 'var(--expense)'}; font-weight:700;">${fmtPct(gbm.totalGainPct)} (${fmtMxn(gbm.totalGainMxn)})</span>
        </div>
        ${bank.creditDebt > 0 ? `
        <div class="breakdown-item" onclick="setTab('bank')" role="button" tabindex="0">
          <div class="breakdown-header" style="color:var(--expense);">💳 Deuda de Crédito</div>
          <div class="breakdown-amt" style="color:var(--expense);">-${fmtMxn(bank.creditDebt)}</div>
          <span style="font-size:11.5px; color:var(--text-muted); font-weight:700;">Ya restada del patrimonio</span>
        </div>` : ''}
      </div>
    </div>

    <div class="quick-flow-bar" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
      <button class="flow-btn income-btn" onclick="openTxModal('in')"><span class="flow-icon-circle" style="color:var(--income);">＋</span><span>Ingreso</span></button>
      <button class="flow-btn expense-btn" onclick="openTxModal('out')"><span class="flow-icon-circle" style="color:var(--expense);">−</span><span>Gasto</span></button>
      <button class="flow-btn" onclick="openTransferModal()" style="border-color:var(--usd-border); background:var(--usd-bg); color:var(--usd-color);"><span class="flow-icon-circle" style="color:var(--usd-color);">⇄</span><span>Transferir</span></button>
    </div>

    ${renderTaxCard(bank, cash)}
    ${renderMonthlyReport()}

    <div class="card">
      <div class="card-title-row">
        <div class="card-title">📈 Evolución del Patrimonio Neto</div>
        <span style="font-size:12px; color:var(--text-muted); font-weight:700;">${snaps.length} registro(s) diario(s)</span>
      </div>
      ${renderAreaChart(snaps.map(s => s.t), 'var(--primary)', snaps.length >= 2 ? [fmtDate(snaps[0].d), fmtDate(snaps[snaps.length - 1].d)] : null, 'La gráfica se llena sola: cada día que uses la app se guarda tu patrimonio.')}
    </div>

    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">Distribución Visual</div>
        <div style="display:flex; gap:6px;">
          <button class="period-pill ${selectedChartMode === 'expenses' ? 'active' : ''}" onclick="setChartMode('expenses')">Gastos</button>
          <button class="period-pill ${selectedChartMode === 'income' ? 'active' : ''}" onclick="setChartMode('income')">Ingresos</button>
          <button class="period-pill ${selectedChartMode === 'portfolio' ? 'active' : ''}" onclick="setChartMode('portfolio')">Activos</button>
        </div>
      </div>
      ${selectedChartMode !== 'portfolio' ? `
        <div class="period-pills-row">
          <button class="period-pill ${currentPeriod === 'month' ? 'active' : ''}" onclick="setPeriod('month')">Este Mes</button>
          <button class="period-pill ${currentPeriod === 'year' ? 'active' : ''}" onclick="setPeriod('year')">Este Año</button>
          <button class="period-pill ${currentPeriod === 'all' ? 'active' : ''}" onclick="setPeriod('all')">Todo</button>
        </div>` : ''}
      ${renderDonutChart(chartItems, chartTitle, chartTotal)}
      <div class="category-list">
        ${chartItems.length === 0 ? `<div class="empty-state">Sin datos en este periodo.</div>` : chartItems.map(item => `
          <div class="category-row">
            <div class="category-left">
              <span class="cat-dot" style="background:${item.color};"></span>
              <span class="cat-name">${item.icon || '📌'} ${esc(item.name)}</span>
            </div>
            <div class="category-right">
              <span class="cat-pct">${num(item.pct).toFixed(1)}%</span>
              <span class="cat-amt">${fmtMxn(item.val)}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderTaxCard(bank, cash) {
  if (!S.settings.taxEnabled) {
    return `
      <div class="alert-box info" style="margin-bottom:18px;">
        <span>🏛️</span>
        <span><b>Apartado de impuestos:</b> actívalo para saber cuánto de tus ingresos debes reservar para el SAT y cuánto dinero tienes realmente disponible.</span>
        <button class="mini-btn" onclick="setTab('data')">Activar</button>
      </div>`;
  }
  const tax = getTaxStats();
  const liquid = bank.debitBal + cash.bal;
  const realAvail = liquid - tax.pending - bank.creditDebt;
  return `
    <div class="card">
      <div class="card-title-row">
        <div class="card-title">🏛️ Impuestos ${tax.year} · Apartado ${num(S.settings.taxRate)}%</div>
        <button class="period-pill" onclick="openTxModal('out', '${TAX_PAY_CATEGORY}')">Registrar pago SAT</button>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-lbl">Apartado este mes</div><div class="kpi-val">${fmtMxn(tax.monthReserved)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Apartado en el año</div><div class="kpi-val">${fmtMxn(tax.reserved)}</div><div class="kpi-sub">Pagado al SAT: ${fmtMxn(tax.paid)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Pendiente por pagar</div><div class="kpi-val" style="color:var(--warning);">${fmtMxn(tax.pending)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Disponible real</div><div class="kpi-val" style="color:${realAvail >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtMxn(realAvail)}</div><div class="kpi-sub">Cuentas + efectivo − impuestos − deuda de crédito</div></div>
      </div>
    </div>`;
}

function renderMonthlyReport() {
  if (!reportMonth) reportMonth = thisMonth();
  const cur = monthSummary(reportMonth);
  const prev = monthSummary(shiftMonth(reportMonth, -1));
  const chg = (a, b) => b > 0 ? ((a - b) / b) * 100 : null;
  const incChg = chg(cur.income, prev.income);
  const expChg = chg(cur.expense, prev.expense);
  const chgHtml = (v, goodUp) => v === null ? '<span class="kpi-sub">Sin datos del mes anterior</span>'
    : `<span class="kpi-sub" style="color:${(v >= 0) === goodUp ? 'var(--income)' : 'var(--expense)'};">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}% vs mes anterior</span>`;

  return `
    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🗓️ Reporte Mensual</div>
        <div class="month-nav">
          <button class="mini-btn" onclick="shiftReportMonth(-1)" aria-label="Mes anterior">‹</button>
          <span>${fmtMonth(reportMonth)}</span>
          <button class="mini-btn" onclick="shiftReportMonth(1)" aria-label="Mes siguiente" ${reportMonth >= thisMonth() ? 'disabled' : ''}>›</button>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-lbl">Ingresos</div><div class="kpi-val" style="color:var(--income);">${fmtMxn(cur.income)}</div>${chgHtml(incChg, true)}</div>
        <div class="kpi"><div class="kpi-lbl">Gastos</div><div class="kpi-val" style="color:var(--expense);">${fmtMxn(cur.expense)}</div>${chgHtml(expChg, false)}</div>
        <div class="kpi"><div class="kpi-lbl">Ahorro del mes</div><div class="kpi-val" style="color:${cur.net >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtMxn(cur.net)}</div><span class="kpi-sub">Tasa de ahorro: ${cur.rate.toFixed(1)}%</span></div>
      </div>
      ${cur.top.length ? `
        <div style="margin-top:14px; font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Donde más gastaste</div>
        <div class="category-list" style="margin-top:6px;">
          ${cur.top.map(([name, val]) => {
            const info = catInfo(name);
            return `<div class="category-row"><div class="category-left"><span class="cat-dot" style="background:${info.color};"></span><span class="cat-name">${info.icon} ${esc(name)}</span></div><div class="category-right"><span class="cat-pct">${cur.expense > 0 ? (val / cur.expense * 100).toFixed(1) : 0}%</span><span class="cat-amt">${fmtMxn(val)}</span></div></div>`;
          }).join('')}
        </div>` : ''}
    </div>`;
}

// ---------- Banco: vista general ----------
function renderBank() {
  const bank = getBankStats();
  // Curva global de cuentas (orden por fecha)
  const cardIds = new Set(S.cards.map(c => c.id));
  let run = S.cards.reduce((a, c) => a + num(c.initial), 0);
  const moves = allMovements().filter(m => m.src === 'tx' || (m.src === 'tr' && (cardIds.has(m.from) || cardIds.has(m.to)))).sort(sortAsc);
  const pts = [run];
  moves.forEach(m => {
    if (m.src === 'tx') run += m.k === 'in' ? m.a : -m.a;
    else run += (cardIds.has(m.to) ? m.a : 0) - (cardIds.has(m.from) ? m.a : 0);
    pts.push(run);
  });

  return `
    <div class="cards-summary-box">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🏦 Resumen de Cuentas & Tarjetas</div>
        <button class="period-pill active" onclick="openAddCardModal()" style="background:var(--primary); color:white;">+ Nueva Tarjeta / Cuenta</button>
      </div>
      <div class="hero-label">Saldo total (débito − deuda de crédito)</div>
      <div class="hero-value">${fmtMxn(bank.bal)}</div>
      <div class="hero-badge-row">
        <span class="pill ${bank.pct >= 0 ? 'up' : 'dn'}">${fmtPct(bank.pct)} vs saldos iniciales</span>
        <span class="pill neutral">${S.cards.length} ${S.cards.length === 1 ? 'cuenta' : 'cuentas'}</span>
        ${bank.creditDebt > 0 ? `<span class="pill dn">💳 Deuda: ${fmtMxn(bank.creditDebt)}</span>` : ''}
      </div>
      <div class="breakdown-grid">
        <div class="breakdown-item"><div class="breakdown-header" style="color:var(--income);">▲ Total Ingresos</div><div class="breakdown-amt" style="color:var(--income);">+${fmtMxn(bank.in)}</div></div>
        <div class="breakdown-item"><div class="breakdown-header" style="color:var(--expense);">▼ Total Gastos</div><div class="breakdown-amt" style="color:var(--expense);">-${fmtMxn(bank.out)}</div></div>
      </div>
    </div>

    <div class="quick-flow-bar" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
      <button class="flow-btn income-btn" onclick="openTxModal('in')"><span class="flow-icon-circle" style="color:var(--income);">＋</span><span>Ingreso</span></button>
      <button class="flow-btn expense-btn" onclick="openTxModal('out')"><span class="flow-icon-circle" style="color:var(--expense);">−</span><span>Gasto</span></button>
      <button class="flow-btn" onclick="openTransferModal()" style="border-color:var(--usd-border); background:var(--usd-bg); color:var(--usd-color);"><span class="flow-icon-circle" style="color:var(--usd-color);">⇄</span><span>Transferir</span></button>
    </div>

    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:6px;">
        <div class="card-title">Tus Tarjetas & Cuentas (${S.cards.length})</div>
        <span style="font-size:12px; color:var(--text-muted); font-weight:700;">Toca una tarjeta para ver su detalle</span>
      </div>
      ${S.cards.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">💳</div>
          <p>No tienes tarjetas agregadas todavía.</p>
          <button class="btn-submit" onclick="openAddCardModal()" style="max-width:240px; margin:14px auto 0;">+ Agregar mi primera tarjeta</button>
        </div>` : `
        <div class="cards-grid">
          ${S.cards.map(card => {
            const st = getCardStats(card.id);
            const credit = st.isCredit;
            const used = credit && num(card.limit) > 0 ? Math.min(100, st.debt / num(card.limit) * 100) : 0;
            return `
              <div class="bank-card-item card-theme-${esc(card.color)}" onclick="enterCardDetail('${card.id}')" role="button" tabindex="0" aria-label="Ver ${esc(card.name)}">
                <div class="card-top-row">
                  <div class="card-name-title"><span>${credit ? '💳' : '🏦'}</span><span>${esc(card.name)}</span></div>
                  <span class="credit-badge">${credit ? 'Crédito' : 'Débito'}</span>
                </div>
                <div class="card-mid-balance">
                  <div class="card-bal-label">${credit ? 'Deuda actual' : 'Saldo actual'}</div>
                  <div class="card-bal-val">${credit ? fmtMxn(st.debt) : fmtMxn(st.bal)}</div>
                  ${credit && num(card.limit) > 0 ? `<div class="card-progress"><span style="width:${used}%"></span></div>` : ''}
                </div>
                <div class="card-bottom-row">
                  <span>${credit
                    ? (num(card.limit) > 0 ? `Disponible: ${fmtShort(num(card.limit) - st.debt)}` : 'Sin límite registrado')
                    : `Ingresos: +${fmtShort(st.in)}`}</span>
                  <span class="card-enter-badge">${credit && card.payDay ? `Pago: ${fmtDate(nextDayOfMonth(card.payDay))}` : 'Ver detalle ➔'}</span>
                </div>
              </div>`;
          }).join('')}
        </div>`}
    </div>

    <div class="card">
      <div class="card-title-row"><div class="card-title">Evolución del Balance Combinado</div></div>
      ${renderAreaChart(pts)}
    </div>

    ${renderMovementSection('all', null, 'Todos los Movimientos')}`;
}

// ---------- Banco: detalle de tarjeta ----------
function renderCardDetail() {
  const st = getCardStats(selectedBankCardId);
  const card = st.card;
  if (!card) { selectedBankCardId = null; return renderBank(); }
  const credit = st.isCredit;

  const moves = allMovements().filter(m => touchesAcct(m, card.id)).sort(sortAsc);
  let run = num(card.initial);
  const pts = [credit ? -run : run];
  moves.forEach(m => { run += signedFor(m, card.id); pts.push(credit ? -run : run); });
  const limit = num(card.limit);
  const used = credit && limit > 0 ? Math.min(100, st.debt / limit * 100) : 0;

  return `
    <button class="back-nav-btn" onclick="exitCardDetail()">← Volver a Todas las Tarjetas</button>

    <div class="card-detail-header-card card-theme-${esc(card.color)}">
      <div class="card-top-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-name-title"><span class="card-chip-icon">${credit ? '💳' : '🏦'}</span><span>${esc(card.name)}</span><span class="credit-badge">${credit ? 'Crédito' : 'Débito'}</span></div>
        <div style="display:flex; gap:6px;">
          <button class="period-pill active" onclick="openEditCardModal('${card.id}')" style="background:rgba(255,255,255,0.25); color:white; border:none;">✏️ Editar</button>
          <button class="period-pill" onclick="deleteCard('${card.id}')" style="background:rgba(0,0,0,0.25); color:white;" aria-label="Eliminar tarjeta">🗑️</button>
        </div>
      </div>
      <div class="card-mid-balance">
        <div class="card-bal-label">${credit ? 'Deuda actual' : 'Saldo disponible'}</div>
        <div class="card-bal-val">${credit ? fmtMxn(st.debt) : fmtMxn(st.bal)}</div>
        ${credit && limit > 0 ? `<div class="card-progress"><span style="width:${used}%"></span></div>` : ''}
      </div>
      <div class="card-bottom-row" style="margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.2); flex-wrap:wrap; gap:6px;">
        ${credit ? `
          <div>Límite: <b>${limit > 0 ? fmtMxn(limit) : '—'}</b> · Disponible: <b>${limit > 0 ? fmtMxn(limit - st.debt) : '—'}</b></div>
          <div>Corte: <b>${card.cutDay ? 'día ' + card.cutDay : '—'}</b> · Pago: <b>${card.payDay ? fmtDate(nextDayOfMonth(card.payDay)) : '—'}</b></div>
        ` : `
          <div>Saldo inicial: <b>${fmtMxn(card.initial)}</b></div>
          <div>Rendimiento: <b>${fmtPct(st.pct)}</b></div>
        `}
      </div>
    </div>

    <div class="quick-flow-bar" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
      <button class="flow-btn income-btn" onclick="openTxModalForCard('in', '${card.id}')"><span class="flow-icon-circle" style="color:var(--income);">＋</span><span>${credit ? 'Abono / Reembolso' : 'Ingreso'}</span></button>
      <button class="flow-btn expense-btn" onclick="openTxModalForCard('out', '${card.id}')"><span class="flow-icon-circle" style="color:var(--expense);">−</span><span>${credit ? 'Compra' : 'Gasto'}</span></button>
      <button class="flow-btn" onclick="${credit ? `openTransferModal(null, '${card.id}')` : `openTransferModal('${card.id}')`}" style="border-color:var(--usd-border); background:var(--usd-bg); color:var(--usd-color);"><span class="flow-icon-circle" style="color:var(--usd-color);">⇄</span><span>${credit ? 'Pagar Tarjeta' : 'Transferir'}</span></button>
    </div>

    <div class="card">
      <div class="card-title-row"><div class="card-title">Flujo de ${esc(card.name)}</div></div>
      <div class="breakdown-grid" style="margin-top:0; padding-top:0; border-top:none;">
        <div class="breakdown-item"><div class="breakdown-header" style="color:var(--income);">▲ Ingresos</div><div class="breakdown-amt" style="color:var(--income);">+${fmtMxn(st.in)}</div></div>
        <div class="breakdown-item"><div class="breakdown-header" style="color:var(--expense);">▼ Gastos</div><div class="breakdown-amt" style="color:var(--expense);">-${fmtMxn(st.out)}</div></div>
      </div>
      <div style="margin-top:20px;">
        <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">${credit ? 'Evolución de la deuda' : 'Evolución del saldo'}</div>
        ${renderAreaChart(pts, credit ? 'var(--expense)' : 'var(--primary)')}
      </div>
    </div>

    ${renderMovementSection(card.id, card.id, `Movimientos en ${card.name}`)}`;
}

// ---------- Efectivo ----------
function renderCash() {
  const cash = getCashStats();
  return `
    <div class="hero-card" style="margin-bottom:18px;">
      <div class="hero-label">Dinero en Efectivo en Mano</div>
      <div class="hero-value" style="color:${cash.bal < 0 ? 'var(--expense)' : 'var(--primary)'};">${fmtMxn(cash.bal)}</div>
      <div class="hero-badge-row">
        <span class="pill up">▲ Entradas: +${fmtMxn(cash.in)}</span>
        <span class="pill dn">▼ Salidas: -${fmtMxn(cash.out)}</span>
        ${cash.tr ? `<span class="pill usd-pill">⇄ Transferencias: ${cash.tr >= 0 ? '+' : ''}${fmtMxn(cash.tr)}</span>` : ''}
      </div>
      <div style="font-size:12.5px; color:var(--text-muted); margin-top:12px; font-weight:600;">💡 Este saldo se suma en tiempo real a tu <b>Patrimonio Neto Total</b>.</div>
    </div>

    <div class="quick-flow-bar" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-bottom:18px;">
      <button class="flow-btn income-btn" onclick="openCashModal('in')"><span class="flow-icon-circle" style="color:var(--income);">＋</span><span>Agregar</span></button>
      <button class="flow-btn expense-btn" onclick="openCashModal('out')"><span class="flow-icon-circle" style="color:var(--expense);">−</span><span>Gastar</span></button>
      <button class="flow-btn" onclick="openTransferModal(null, 'cash')" style="border-color:var(--usd-border); background:var(--usd-bg); color:var(--usd-color);"><span class="flow-icon-circle" style="color:var(--usd-color);">⇄</span><span>Retiro de cajero</span></button>
      <button class="flow-btn" onclick="openCashModal('set')" style="border-color:var(--card-border); background:var(--surface-subtle); color:var(--text-main);"><span class="flow-icon-circle">✏️</span><span>Ajustar Saldo</span></button>
    </div>

    ${renderMovementSection('cash', 'cash', 'Movimientos de Efectivo')}`;
}

// ---------- Lista de movimientos con filtros ----------
function getFilter(key) {
  if (!filters[key]) filters[key] = { q: '', type: 'all', acct: 'all', cat: 'all', month: '', limit: 60 };
  return filters[key];
}
const safeKey = key => String(key).replace(/[^a-zA-Z0-9_-]/g, '_');

function filteredMovements(key, fixedAcct) {
  const f = getFilter(key);
  const q = f.q.trim().toLowerCase();
  return allMovements().filter(m => {
    if (fixedAcct && !touchesAcct(m, fixedAcct)) return false;
    if (!fixedAcct && f.acct !== 'all' && !touchesAcct(m, f.acct)) return false;
    if (f.type !== 'all' && m.k !== f.type) return false;
    if (f.cat !== 'all' && m.c !== f.cat) return false;
    if (f.month && !(m.d || '').startsWith(f.month)) return false;
    if (q) {
      const hay = [m.n, m.c, m.src === 'tr' ? accountName(m.from) + ' ' + accountName(m.to) : accountName(m.acct), String(m.a)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort(sortDesc);
}

function renderMovementSection(key, fixedAcct, title) {
  const f = getFilter(key);
  const sk = safeKey(key);
  const allCats = [...new Set(allMovements().map(m => m.c).filter(Boolean))].sort();
  const addBtn = fixedAcct === 'cash'
    ? `<button class="period-pill active" onclick="openCashModal('in')">+ Registrar</button>`
    : `<button class="period-pill active" onclick="${fixedAcct ? `openTxModalForCard('in', '${fixedAcct}')` : `openTxModal('in')`}">+ Agregar</button>`;
  return `
    <div class="card">
      <div class="card-title-row">
        <div class="card-title">${esc(title)}</div>
        ${addBtn}
      </div>
      <div class="filter-bar">
        <input type="search" class="input-field filter-search" placeholder="🔎 Buscar concepto, categoría o monto…" value="${esc(f.q)}" oninput="updateFilter('${key}', 'q', this.value, ${fixedAcct ? `'${fixedAcct}'` : 'null'})" aria-label="Buscar movimientos">
        <select class="select-field" onchange="updateFilter('${key}', 'type', this.value, ${fixedAcct ? `'${fixedAcct}'` : 'null'})" aria-label="Tipo">
          <option value="all" ${f.type === 'all' ? 'selected' : ''}>Todos los tipos</option>
          <option value="in" ${f.type === 'in' ? 'selected' : ''}>Ingresos</option>
          <option value="out" ${f.type === 'out' ? 'selected' : ''}>Gastos</option>
          <option value="tr" ${f.type === 'tr' ? 'selected' : ''}>Transferencias</option>
        </select>
        <input type="month" class="input-field" value="${esc(f.month)}" onchange="updateFilter('${key}', 'month', this.value, ${fixedAcct ? `'${fixedAcct}'` : 'null'})" aria-label="Mes">
        ${!fixedAcct ? `
          <select class="select-field" onchange="updateFilter('${key}', 'acct', this.value, null)" aria-label="Cuenta">
            <option value="all">Todas las cuentas</option>
            ${accountOptionsHtml(f.acct, { cash: true, gbm: true })}
          </select>` : ''}
        <select class="select-field" onchange="updateFilter('${key}', 'cat', this.value, ${fixedAcct ? `'${fixedAcct}'` : 'null'})" aria-label="Categoría">
          <option value="all">Todas las categorías</option>
          ${allCats.map(c => `<option value="${esc(c)}" ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="mvlist_${sk}">${renderMovementItems(key, fixedAcct)}</div>
    </div>`;
}

function renderMovementItems(key, fixedAcct) {
  const f = getFilter(key);
  const list = filteredMovements(key, fixedAcct);
  if (!list.length) {
    const any = f.q || f.type !== 'all' || f.acct !== 'all' || f.cat !== 'all' || f.month;
    return `<div class="empty-state"><div class="empty-icon">📝</div>${any ? 'Ningún movimiento coincide con los filtros.' : 'No hay movimientos registrados aún.'}</div>`;
  }
  let inSum = 0, outSum = 0;
  list.forEach(m => {
    if (m.src === 'tr') { if (fixedAcct) { const s = signedFor(m, fixedAcct); if (s > 0) inSum += s; else outSum -= s; } }
    else if (m.k === 'in') inSum += m.a; else outSum += m.a;
  });
  const shown = list.slice(0, f.limit);
  return `
    <div class="filter-summary">${list.length} movimiento(s) · Entradas +${fmtMxn(inSum)} · Salidas -${fmtMxn(outSum)}</div>
    <div class="tx-list">${shown.map(m => movementItemHtml(m, fixedAcct)).join('')}</div>
    ${list.length > shown.length ? `<button class="btn-secondary" onclick="showMore('${key}', ${fixedAcct ? `'${fixedAcct}'` : 'null'})">Ver más (${list.length - shown.length} restantes)</button>` : ''}`;
}

function movementItemHtml(m, fixedAcct) {
  if (m.src === 'tr') {
    const signed = fixedAcct ? signedFor(m, fixedAcct) : null;
    return `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-icon-badge tr">⇄</div>
          <div>
            <div class="tx-title">${esc(m.n || 'Transferencia')}</div>
            <div class="tx-meta">
              <span>${fmtDate(m.d)}</span>
              <span class="tag">${accountIcon(m.from)} ${esc(accountName(m.from))} → ${accountIcon(m.to)} ${esc(accountName(m.to))}</span>
            </div>
          </div>
        </div>
        <div class="tx-right">
          <span class="tx-amount tr">${signed === null ? '' : signed >= 0 ? '+' : '-'}${fmtMxn(m.a)}</span>
          <button class="tx-edit-btn" onclick="openTransferModal(null, null, '${m.id}')" title="Editar" aria-label="Editar">✏️</button>
          <button class="tx-del-btn" onclick="deleteMovement('tr', '${m.id}')" title="Eliminar" aria-label="Eliminar">✕</button>
        </div>
      </div>`;
  }
  const isIn = m.k === 'in';
  return `
    <div class="tx-item">
      <div class="tx-left">
        <div class="tx-icon-badge ${isIn ? 'in' : 'out'}">${catInfo(m.c).icon}</div>
        <div>
          <div class="tx-title">${esc(m.n || (isIn ? 'Ingreso' : 'Gasto'))}</div>
          <div class="tx-meta">
            <span>${fmtDate(m.d)}</span>
            ${!fixedAcct ? `<span class="tag">${accountIcon(m.acct)} ${esc(accountName(m.acct))}</span>` : ''}
            ${m.c ? `<span>• ${esc(m.c)}</span>` : ''}
            ${m.rec ? `<span class="tag" title="Recurrente">🔁</span>` : ''}
            ${m.inv ? `<span class="tag" title="Cobro de factura">🧾</span>` : ''}
            ${isIn && m.tax > 0 ? `<span class="tag warn" title="Apartado para impuestos">Imp. ${m.tax}%</span>` : ''}
          </div>
        </div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${fmtMxn(m.a)}</span>
        <button class="tx-edit-btn" onclick="openEditMovement('${m.src}', '${m.id}')" title="Editar" aria-label="Editar">✏️</button>
        <button class="tx-del-btn" onclick="deleteMovement('${m.src}', '${m.id}')" title="Eliminar" aria-label="Eliminar">✕</button>
      </div>
    </div>`;
}

function updateFilter(key, field, value, fixedAcct) {
  const f = getFilter(key);
  f[field] = value;
  f.limit = 60;
  const el = $('mvlist_' + safeKey(key));
  if (el) el.innerHTML = renderMovementItems(key, fixedAcct);
}
function showMore(key, fixedAcct) {
  getFilter(key).limit += 100;
  const el = $('mvlist_' + safeKey(key));
  if (el) el.innerHTML = renderMovementItems(key, fixedAcct);
}

// ---------- GBM ----------
function renderGbm() {
  if (S.invested === null) {
    return `
      <div class="lock-screen" style="max-width:540px; margin:20px auto;">
        <div class="lock-badge-icon">💰</div>
        <h1 style="font-size:24px;">¿Cuánto dinero has invertido en GBM?</h1>
        <p>Ingresa el <b>capital total en Pesos (MXN)</b> que has depositado a GBM desde que empezaste (sin contar ganancias).</p>
        <div style="max-width:340px; margin:0 auto; text-align:left;">
          <label class="form-label" for="initInvestedInput">Total depositado de tu bolsillo ($ MXN):</label>
          <input id="initInvestedInput" class="input-field" type="number" min="0" step="any" placeholder="Ej. 50000" style="margin-bottom:12px;">
          <button class="btn-submit" onclick="setInitialInvested()">Guardar y Continuar al Portafolio 🚀</button>
          <button class="btn-secondary" style="margin-top:8px;" onclick="setInitialInvested(0)">Aún no invierto, empezar en $0</button>
        </div>
      </div>`;
  }

  const g = getGbmStats();
  const us = S.stocks.filter(s => s.c === 'USD');
  const mx = S.stocks.filter(s => s.c === 'MXN');
  const bars = S.stocks.filter(s => stockQty(s) > 0).map(s => {
    const avg = stockAvg(s);
    return { l: `${s.t} (${s.c})`, v: avg > 0 ? ((num(s.p) - avg) / avg) * 100 : 0 };
  });

  const section = (list, cur) => {
    const isUsd = cur === 'USD';
    return `
      <div class="card" style="border-top: 4px solid var(${isUsd ? '--usd-color' : '--mxn-color'});">
        <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
          <div>
            <div class="card-title" style="color:var(${isUsd ? '--usd-color' : '--mxn-color'});">${isUsd ? '🇺🇸 Mercado EE.UU. (USD → MXN)' : '🇲🇽 Mercado Mexicano (BMV / MXN)'}</div>
            <div style="font-size:12.5px; color:var(--text-muted); margin-top:3px;">
              ${isUsd
                ? `Costo: <b>${fmtUsd(g.usInvestedUsd)}</b> (≈ ${fmtMxn(g.usInvestedInMxn)}) · Ganancia: <b style="color:${g.usGainUsd >= 0 ? 'var(--income)' : 'var(--expense)'}">${fmtUsd(g.usGainUsd)}</b> (${fmtPct(g.usGainPct)})`
                : `Costo: <b>${fmtMxn(g.mxInvestedMxn)}</b> · Ganancia: <b style="color:${g.mxGainMxn >= 0 ? 'var(--income)' : 'var(--expense)'}">${fmtMxn(g.mxGainMxn)}</b> (${fmtPct(g.mxGainPct)})`}
            </div>
          </div>
          <button class="period-pill active" onclick="openStockModal('${cur}')" style="background:var(${isUsd ? '--usd-color' : '--mxn-color'}); color:white;">+ Comprar ${cur}</button>
        </div>
        ${list.length === 0 ? `<div class="empty-state">No tienes acciones ${isUsd ? 'de EE.UU.' : 'mexicanas'} registradas aún.</div>` : `
          <div class="stock-grid">${list.map(stockCardHtml).join('')}</div>`}
      </div>`;
  };

  return `
    <div class="hero-card" style="margin-bottom:18px;">
      <div class="hero-label">Valor Total de la Cuenta GBM (MXN)</div>
      <div class="hero-value">${fmtMxn(g.totalPortfolioValMxn)}</div>
      <div class="hero-badge-row">
        <span class="pill ${g.totalGainMxn >= 0 ? 'up' : 'dn'}">${g.totalGainMxn >= 0 ? '▲ Rendimiento' : '▼ Pérdida'} ${fmtMxn(g.totalGainMxn)} (${fmtPct(g.totalGainPct)})</span>
        <span class="pill neutral">Depositado: <b>&nbsp;${fmtMxn(g.totalInvestedMxn)}</b></span>
      </div>
      <div class="breakdown-grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));">
        <div class="breakdown-item" onclick="setGbmMarketView('usd')" role="button" tabindex="0">
          <div class="breakdown-header" style="color:var(--usd-color);">🇺🇸 Acciones EE.UU.</div>
          <div class="breakdown-amt">${fmtMxn(g.usCurrentValInMxn)}</div>
          <span style="font-size:12px; color:var(--text-muted); font-weight:700;">≈ ${fmtUsd(g.usCurrentValUsd)}</span>
        </div>
        <div class="breakdown-item" onclick="setGbmMarketView('mxn')" role="button" tabindex="0">
          <div class="breakdown-header" style="color:var(--mxn-color);">🇲🇽 Acciones México</div>
          <div class="breakdown-amt">${fmtMxn(g.mxCurrentValMxn)}</div>
          <span style="font-size:12px; color:${g.mxGainMxn >= 0 ? 'var(--income)' : 'var(--expense)'}; font-weight:700;">${fmtPct(g.mxGainPct)}</span>
        </div>
        <div class="breakdown-item" onclick="openLiquidAdjust()" role="button" tabindex="0">
          <div class="breakdown-header" style="color:var(--warning);">💵 Saldo líquido</div>
          <div class="breakdown-amt" style="color:${g.liquid < 0 ? 'var(--expense)' : 'var(--text-main)'};">${fmtMxn(g.liquid)}</div>
          <span style="font-size:12px; color:var(--text-muted); font-weight:700;">Sin invertir · toca para ajustar</span>
        </div>
      </div>
    </div>

    <div class="quick-flow-bar" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom:18px;">
      <button class="flow-btn income-btn" onclick="openGbmCapitalModal('deposit')"><span class="flow-icon-circle" style="color:var(--income);">＋</span><span>📥 Depositar</span></button>
      <button class="flow-btn expense-btn" onclick="openGbmCapitalModal('withdraw')"><span class="flow-icon-circle" style="color:var(--expense);">−</span><span>📤 Retirar</span></button>
      <button class="flow-btn" onclick="openDividendModal()" style="border-color:var(--usd-border); background:var(--usd-bg); color:var(--usd-color);"><span class="flow-icon-circle" style="color:var(--usd-color);">💰</span><span>Dividendo</span></button>
    </div>

    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">💰 Tu Capital vs Ganancias</div>
        <button class="period-pill" onclick="openGbmCapitalModal('set')">✏️ Ajustar capital</button>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-lbl">Capital depositado</div><div class="kpi-val">${fmtMxn(g.totalInvestedMxn)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Ganancia total</div><div class="kpi-val" style="color:${g.totalGainMxn >= 0 ? 'var(--income)' : 'var(--expense)'};">${g.totalGainMxn >= 0 ? '+' : ''}${fmtMxn(g.totalGainMxn)}</div><div class="kpi-sub">${fmtPct(g.totalGainPct)} sobre lo depositado</div></div>
        <div class="kpi"><div class="kpi-lbl">Dividendos cobrados</div><div class="kpi-val" style="color:var(--income);">${fmtMxn(g.dividendsMxn)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Ganancia realizada (ventas)</div><div class="kpi-val" style="color:${g.realizedMxn >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtMxn(g.realizedMxn)}</div></div>
      </div>
    </div>

    <div class="exchange-rate-card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="font-size:14px; font-weight:800; color:var(--usd-color);">💱 Tipo de Cambio USD / MXN</div>
        <span class="pill neutral" style="font-size:11px;">Actualizado: ${fmtDate(S.fxd)}</span>
      </div>
      <div class="fx-input-row">
        <label for="fxInput" style="font-weight:800; font-size:15px;">1 USD =</label>
        <input id="fxInput" type="number" step="any" min="0.0001" value="${num(S.fx)}" class="stock-price-input" style="width:110px; font-size:15px;" onchange="updateFxRate(this.value)">
        <span style="font-weight:800; font-size:15px;">MXN</span>
        <button class="mini-btn" id="fxAutoBtn" onclick="refreshFx(false)">🔄 Actualizar automático</button>
      </div>
      <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">💡 Se actualiza solo una vez al día al abrir la app (puedes desactivarlo en Ajustes). Fuente: Banco Central Europeo vía Frankfurter.</div>
    </div>

    <div class="market-subtabs">
      <button class="market-subtab-btn ${gbmMarketView === 'all' ? 'active' : ''}" onclick="setGbmMarketView('all')">🌐 Todos</button>
      <button class="market-subtab-btn ${gbmMarketView === 'usd' ? 'active' : ''}" onclick="setGbmMarketView('usd')">🇺🇸 EE.UU. (${us.length})</button>
      <button class="market-subtab-btn ${gbmMarketView === 'mxn' ? 'active' : ''}" onclick="setGbmMarketView('mxn')">🇲🇽 México (${mx.length})</button>
    </div>

    ${gbmMarketView !== 'mxn' ? section(us, 'USD') : ''}
    ${gbmMarketView !== 'usd' ? section(mx, 'MXN') : ''}

    <div class="card">
      <div class="card-title-row"><div class="card-title">📊 Rendimiento vs Precio Promedio de Compra</div></div>
      ${renderBarPerformance(bars)}
    </div>

    <div class="card">
      <div class="card-title-row">
        <div class="card-title">💰 Dividendos (${S.dividends.length})</div>
        <button class="period-pill active" onclick="openDividendModal()">+ Registrar</button>
      </div>
      ${S.dividends.length === 0 ? `<div class="empty-state">Aún no registras dividendos.</div>` : `
        <div style="overflow-x:auto;">
          <table class="history-table">
            <thead><tr><th>Fecha</th><th>Ticker</th><th>Monto</th><th>En MXN</th><th></th></tr></thead>
            <tbody>
              ${S.dividends.slice().sort((a, b) => (b.d || '').localeCompare(a.d || '')).map(d => `
                <tr>
                  <td>${fmtDate(d.d)}</td><td><b>${esc(d.t)}</b></td><td>${fmtCur(d.a, d.c)}</td><td>${fmtMxn(d.mxn)}</td>
                  <td style="text-align:right;"><button class="tx-del-btn" onclick="deleteDividend('${d.id}')" aria-label="Eliminar">✕</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

function stockCardHtml(s) {
  const isUsd = s.c === 'USD';
  const q = stockQty(s);
  const avg = stockAvg(s);
  const cur = num(s.p);
  const cost = q * avg;
  const val = q * cur;
  const gain = val - cost;
  const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
  const m = fxMult(s.c);
  const realized = s.sales.reduce((a, x) => a + num(x.gain), 0);
  const closed = q <= 0;
  const open = !!expandedStocks[s.id];

  return `
    <div class="stock-card ${isUsd ? 'usd-market' : 'mxn-market'} ${closed ? 'closed' : ''}">
      <div class="stock-header" style="flex-wrap:wrap; gap:8px;">
        <div class="stock-ticker">
          <span>${esc(s.t)}</span>
          <span class="pill ${isUsd ? 'usd-pill' : 'mxn-pill'}">${isUsd ? 'USD · EE.UU.' : 'MXN · BMV'}</span>
          ${closed ? '<span class="tag">Posición cerrada</span>' : ''}
        </div>
        ${!closed ? `<span class="pill ${gain >= 0 ? 'up' : 'dn'}">${gain >= 0 ? '▲' : '▼'} ${fmtCur(gain, s.c)} (${fmtPct(gainPct)})</span>` : ''}
      </div>

      <div class="stock-body">
        <div class="stock-stat-box">
          <span class="stock-stat-lbl">Valor de mercado</span>
          <span class="stock-stat-val" style="color:var(${isUsd ? '--usd-color' : '--mxn-color'});">${fmtCur(val, s.c)}</span>
          ${isUsd ? `<span style="font-size:11.5px; color:var(--text-muted); font-weight:700;">≈ ${fmtMxn(val * m)}</span>` : ''}
        </div>
        <div class="stock-stat-box">
          <span class="stock-stat-lbl">Costo de compra</span>
          <span class="stock-stat-val">${fmtCur(cost, s.c)}</span>
          ${isUsd ? `<span style="font-size:11.5px; color:var(--text-muted); font-weight:700;">≈ ${fmtMxn(cost * m)}</span>` : ''}
        </div>
        <div class="stock-stat-box">
          <span class="stock-stat-lbl">Títulos · Precio promedio</span>
          <span class="stock-stat-val">${fmtQty(q)} @ ${fmtCur(avg, s.c)}</span>
          ${realized ? `<span style="font-size:11.5px; color:${realized >= 0 ? 'var(--income)' : 'var(--expense)'}; font-weight:700;">Realizado: ${fmtCur(realized, s.c)}</span>` : ''}
        </div>
        <div class="stock-stat-box">
          <label class="stock-stat-lbl" for="price_${s.id}">Precio hoy (${s.c})</label>
          <div class="stock-price-input-wrap">
            <input id="price_${s.id}" type="number" step="any" min="0" value="${cur}" class="stock-price-input" onchange="updateStockPrice('${s.id}', this.value)">
          </div>
        </div>
      </div>

      <div class="stock-actions">
        <button class="mini-btn" onclick="openStockModal('${s.c}', '${s.id}')">＋ Compra</button>
        ${!closed ? `<button class="mini-btn" onclick="openSellModal('${s.id}')">− Vender</button>` : ''}
        <button class="mini-btn" onclick="openDividendModal('${s.id}')">💰 Dividendo</button>
        <button class="mini-btn" onclick="toggleStockHistory('${s.id}')">${open ? '▲ Ocultar historial' : '▼ Historial'}</button>
        <button class="mini-btn danger" onclick="deleteStock('${s.id}')">🗑️ Eliminar</button>
      </div>

      ${open ? `
        <div style="overflow-x:auto;">
          <table class="history-table">
            <thead><tr><th>Compra</th><th>Títulos</th><th>Precio</th><th>Pagado GBM</th><th></th></tr></thead>
            <tbody>
              ${s.lots.length === 0 ? `<tr><td colspan="5">Sin compras abiertas.</td></tr>` : s.lots.map((l, i) => `
                <tr>
                  <td>${l.d ? fmtDate(l.d) : '—'}</td><td>${fmtQty(l.q)}</td><td>${fmtCur(l.b, s.c)}</td><td>${num(l.paid) ? fmtMxn(l.paid) : '—'}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="tx-edit-btn" onclick="openStockModal('${s.c}', '${s.id}', ${i})" aria-label="Editar compra">✏️</button>
                    <button class="tx-del-btn" onclick="deleteLot('${s.id}', ${i})" aria-label="Eliminar compra">✕</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${s.sales.length ? `
            <table class="history-table">
              <thead><tr><th>Venta</th><th>Títulos</th><th>Precio</th><th>Ganancia</th><th></th></tr></thead>
              <tbody>
                ${s.sales.map(x => `
                  <tr>
                    <td>${fmtDate(x.d)}</td><td>${fmtQty(x.q)}</td><td>${fmtCur(x.price, s.c)}</td>
                    <td style="color:${num(x.gain) >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtCur(x.gain, s.c)}</td>
                    <td style="text-align:right;"><button class="tx-del-btn" onclick="deleteSale('${s.id}', '${x.id}')" aria-label="Deshacer venta">✕</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>` : ''}
        </div>` : ''}
    </div>`;
}

// ---------- Planeación ----------
function renderPlan() {
  const t = today();
  const pendingInv = S.invoices.filter(i => i.status !== 'paid').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const paidInv = S.invoices.filter(i => i.status === 'paid').sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || '')).slice(0, 10);
  const pendingTotal = pendingInv.reduce((a, i) => a + num(i.a), 0);
  const overdueTotal = pendingInv.filter(i => i.due < t).reduce((a, i) => a + num(i.a), 0);
  const spent = monthSpentByCategory(thisMonth());
  const budgetTotal = Object.values(S.budgets).reduce((a, b) => a + num(b), 0);
  const budgetSpent = Object.keys(S.budgets).filter(k => num(S.budgets[k]) > 0).reduce((a, k) => a + (spent[k] || 0), 0);

  const freqLbl = { monthly: 'Mensual', biweekly: 'Quincenal', weekly: 'Semanal', yearly: 'Anual' };
  const monthlyEq = r => r.freq === 'weekly' ? r.a * 52 / 12 : r.freq === 'biweekly' ? r.a * 26 / 12 : r.freq === 'yearly' ? r.a / 12 : r.a;
  const recIn = S.recurring.filter(r => r.active && r.k === 'in').reduce((a, r) => a + monthlyEq(r), 0);
  const recOut = S.recurring.filter(r => r.active && r.k === 'out').reduce((a, r) => a + monthlyEq(r), 0);

  return `
    <!-- Cuentas por cobrar -->
    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🧾 Cuentas por Cobrar</div>
        <button class="period-pill active" onclick="openInvoiceModal()" style="background:var(--primary); color:white;">+ Nueva Factura</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px;">
        <div class="kpi"><div class="kpi-lbl">Por cobrar</div><div class="kpi-val">${fmtMxn(pendingTotal)}</div><div class="kpi-sub">${pendingInv.length} factura(s)</div></div>
        <div class="kpi"><div class="kpi-lbl">Vencido</div><div class="kpi-val" style="color:${overdueTotal > 0 ? 'var(--expense)' : 'var(--text-main)'};">${fmtMxn(overdueTotal)}</div></div>
      </div>
      ${pendingInv.length === 0 ? `<div class="empty-state" style="padding:16px;">No tienes facturas pendientes de cobro. 🎉</div>` : pendingInv.map(i => {
        const days = daysBetween(t, i.due);
        const status = days < 0 ? `<span class="tag bad">Vencida hace ${-days} d</span>` : days <= 3 ? `<span class="tag warn">Vence ${days === 0 ? 'hoy' : `en ${days} d`}</span>` : `<span class="tag">Vence ${fmtDate(i.due)}</span>`;
        return `
          <div class="plan-row">
            <div class="plan-row-top">
              <div>
                <div class="plan-row-title">${esc(i.client)} · ${fmtMxn(i.a)}</div>
                <div class="plan-row-sub">${esc(i.concept || 'Sin concepto')} · Emitida ${fmtDate(i.issued)} · ${accountIcon(i.acct)} ${esc(accountName(i.acct))}</div>
              </div>
              ${status}
            </div>
            <div class="stock-actions">
              <button class="mini-btn" onclick="markInvoicePaid('${i.id}')">✅ Marcar cobrada</button>
              <button class="mini-btn" onclick="openInvoiceModal('${i.id}')">✏️ Editar</button>
              <button class="mini-btn danger" onclick="deleteInvoice('${i.id}')">🗑️</button>
            </div>
          </div>`;
      }).join('')}
      ${paidInv.length ? `
        <details style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:13px; font-weight:800; color:var(--text-muted);">Cobradas recientemente (${paidInv.length})</summary>
          ${paidInv.map(i => `
            <div class="plan-row" style="margin-top:8px;">
              <div class="plan-row-top">
                <div><div class="plan-row-title">${esc(i.client)} · ${fmtMxn(i.a)}</div><div class="plan-row-sub">Cobrada ${fmtDate(i.paidDate)}</div></div>
                <button class="mini-btn" onclick="markInvoiceUnpaid('${i.id}')">↩️ Deshacer cobro</button>
              </div>
            </div>`).join('')}
        </details>` : ''}
    </div>

    <!-- Recurrentes -->
    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🔁 Ingresos y Gastos Recurrentes</div>
        <button class="period-pill active" onclick="openRecurringModal()" style="background:var(--primary); color:white;">+ Nuevo</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px;">
        <div class="kpi"><div class="kpi-lbl">Ingresos fijos / mes</div><div class="kpi-val" style="color:var(--income);">${fmtMxn(recIn)}</div></div>
        <div class="kpi"><div class="kpi-lbl">Gastos fijos / mes</div><div class="kpi-val" style="color:var(--expense);">${fmtMxn(recOut)}</div></div>
      </div>
      ${S.recurring.length === 0 ? `<div class="empty-state" style="padding:16px;">Agrega tu renta, suscripciones o igualas para que se registren solas.</div>` : S.recurring.slice().sort((a, b) => (a.next || '').localeCompare(b.next || '')).map(r => `
        <div class="plan-row" style="${r.active ? '' : 'opacity:0.55;'}">
          <div class="plan-row-top">
            <div>
              <div class="plan-row-title">${catInfo(r.c).icon} ${esc(r.n)} · <span style="color:${r.k === 'in' ? 'var(--income)' : 'var(--expense)'};">${r.k === 'in' ? '+' : '-'}${fmtMxn(r.a)}</span></div>
              <div class="plan-row-sub">${freqLbl[r.freq] || r.freq} · ${accountIcon(r.acct)} ${esc(accountName(r.acct))} · ${r.active ? `Próximo: ${fmtDate(r.next)}` : 'En pausa'}</div>
            </div>
            <div class="stock-actions" style="margin-top:0;">
              <button class="mini-btn" onclick="toggleRecurring('${r.id}')">${r.active ? '⏸️ Pausar' : '▶️ Activar'}</button>
              <button class="mini-btn" onclick="openRecurringModal('${r.id}')">✏️</button>
              <button class="mini-btn danger" onclick="deleteRecurring('${r.id}')">🗑️</button>
            </div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Presupuestos -->
    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">📋 Presupuesto Mensual por Categoría</div>
        <span style="font-size:12px; color:var(--text-muted); font-weight:700;">${fmtMonth(thisMonth())}</span>
      </div>
      ${budgetTotal > 0 ? `
        <div class="plan-row">
          <div class="plan-row-top"><div class="plan-row-title">Total presupuestado</div><div class="plan-row-sub">${fmtMxn(budgetSpent)} de ${fmtMxn(budgetTotal)}</div></div>
          ${progressHtml(budgetSpent, budgetTotal)}
        </div>` : `<p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Escribe un límite mensual en las categorías que quieras controlar. Te avisaremos al llegar al 80% y al 100%.</p>`}
      ${EXPENSE_CATEGORIES.map(c => {
        const lim = num(S.budgets[c.name]);
        const s = spent[c.name] || 0;
        return `
          <div class="plan-row">
            <div class="plan-row-top">
              <div>
                <div class="plan-row-title">${c.icon} ${esc(c.name)}</div>
                <div class="plan-row-sub">Gastado este mes: ${fmtMxn(s)}${lim > 0 ? ` · Restante: ${fmtMxn(lim - s)}` : ''}</div>
              </div>
              <input type="number" class="budget-input" min="0" step="any" placeholder="Sin límite" value="${lim > 0 ? lim : ''}" onchange="setBudget(${EXPENSE_CATEGORIES.indexOf(c)}, this.value)" aria-label="Presupuesto ${esc(c.name)}">
            </div>
            ${lim > 0 ? progressHtml(s, lim) : ''}
          </div>`;
      }).join('')}
    </div>

    <!-- Metas -->
    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🎯 Metas de Ahorro</div>
        <button class="period-pill active" onclick="openGoalModal()" style="background:var(--primary); color:white;">+ Nueva Meta</button>
      </div>
      ${S.goals.length === 0 ? `<div class="empty-state" style="padding:16px;">Crea una meta: fondo de emergencia, equipo nuevo, vacaciones…</div>` : S.goals.map(g => {
        const pct = g.target > 0 ? Math.min(100, g.saved / g.target * 100) : 0;
        let pace = '';
        if (g.due && g.saved < g.target) {
          const days = daysBetween(t, g.due);
          if (days > 0) {
            const months = Math.max(1, days / 30.44);
            pace = ` · Ahorra ${fmtMxn((g.target - g.saved) / months)}/mes para llegar el ${fmtDate(g.due)}`;
          } else pace = ' · ⚠️ Fecha objetivo vencida';
        }
        return `
          <div class="plan-row">
            <div class="plan-row-top">
              <div>
                <div class="plan-row-title">${pct >= 100 ? '🏆' : '🎯'} ${esc(g.name)}</div>
                <div class="plan-row-sub">${fmtMxn(g.saved)} de ${fmtMxn(g.target)} (${pct.toFixed(0)}%)${pace}</div>
              </div>
              <div class="stock-actions" style="margin-top:0;">
                <button class="mini-btn" onclick="contributeGoal('${g.id}')">＋ Abonar</button>
                <button class="mini-btn" onclick="openGoalModal('${g.id}')">✏️</button>
                <button class="mini-btn danger" onclick="deleteGoal('${g.id}')">🗑️</button>
              </div>
            </div>
            <div class="progress"><span style="width:${pct}%"></span></div>
          </div>`;
      }).join('')}
    </div>`;
}

function progressHtml(val, max) {
  const pct = max > 0 ? val / max * 100 : 0;
  const cls = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  return `<div class="progress ${cls}" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, pct)}%"></span></div>`;
}

// ---------- Ajustes & Datos ----------
function renderData() {
  const st = S.settings;
  return `
    <div class="card" style="text-align:center; padding:24px 20px;">
      <img src="logo.png" alt="Budget Control" class="app-logo-img" style="max-height:130px; width:auto; margin-bottom:8px;">
      <div style="font-size:12px; color:var(--text-muted); font-weight:700;">Versión 2 · Datos guardados solo en este dispositivo</div>
    </div>

    <div class="card">
      <div class="card-title-row" style="flex-wrap:wrap; gap:8px;">
        <div class="card-title">🔐 Seguridad</div>
        <button class="period-pill active" onclick="openChangePassModal()">🔑 Cambiar Contraseña & Pista</button>
      </div>
      <div class="alert-box ${session.plain ? 'warn' : 'info'}">
        <span>${session.plain ? '⚠️' : '🛡️'}</span>
        <span>${session.plain
          ? 'Este navegador no permite cifrado en esta dirección. Tus datos se guardan sin cifrar. Abre la app como archivo local o desde https para activarlo.'
          : 'Tus datos están <b>cifrados con AES-256</b>. La clave se genera a partir de tu contraseña y nunca se guarda: sin la contraseña nadie puede leerlos.'}</span>
      </div>
      <div class="plan-row">
        <div class="plan-row-top">
          <div><div class="plan-row-sub">Pista registrada</div><div class="plan-row-title">💡 "${esc(session.hint || 'Sin pista')}"</div></div>
        </div>
      </div>
      <div class="plan-row">
        <div class="plan-row-top">
          <label class="plan-row-title" for="autoLockSel">⏱️ Bloquear automáticamente tras inactividad</label>
          <select id="autoLockSel" class="select-field" style="width:auto;" onchange="updateSetting('autoLockMin', Number(this.value))">
            ${[[0, 'Nunca'], [1, '1 minuto'], [3, '3 minutos'], [5, '5 minutos'], [10, '10 minutos'], [30, '30 minutos']].map(([v, l]) => `<option value="${v}" ${num(st.autoLockMin) === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="plan-row">
        <label class="checkbox-row"><input type="checkbox" ${st.lockOnHide ? 'checked' : ''} onchange="updateSetting('lockOnHide', this.checked)"> Bloquear al cambiar de pestaña o minimizar</label>
      </div>
    </div>

    ${typeof cloudSettingsHtml === 'function' ? cloudSettingsHtml() : ''}

    <div class="card">
      <div class="card-title-row"><div class="card-title">🏛️ Apartado de Impuestos</div></div>
      <div class="plan-row">
        <label class="checkbox-row"><input type="checkbox" ${st.taxEnabled ? 'checked' : ''} onchange="updateSetting('taxEnabled', this.checked)"> Activar apartado de impuestos en mis ingresos</label>
      </div>
      <div class="plan-row ${st.taxEnabled ? '' : 'hidden'}">
        <div class="plan-row-top">
          <label class="plan-row-title" for="taxRateInput">Porcentaje a apartar de cada ingreso</label>
          <input id="taxRateInput" type="number" class="budget-input" min="0" max="100" step="any" value="${num(st.taxRate)}" onchange="updateSetting('taxRate', Math.min(100, Math.max(0, Number(this.value) || 0)))">
        </div>
        <div class="category-chips" style="margin-top:10px;">
          <button class="cat-chip" onclick="updateSetting('taxRate', 16)">RESICO + IVA ≈ 16%</button>
          <button class="cat-chip" onclick="updateSetting('taxRate', 25)">Actividad empresarial ≈ 25%</button>
          <button class="cat-chip" onclick="updateSetting('taxRate', 30)">Conservador 30%</button>
        </div>
        <span class="form-hint" style="margin-top:8px;">Se aplica a ingresos de clientes, igualas, hitos y consultorías (puedes desmarcarlo en cada ingreso). Los pagos con la categoría "${TAX_PAY_CATEGORY}" se descuentan de lo pendiente. Es una estimación: confirma las cifras con tu contador.</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title-row"><div class="card-title">💱 Inversiones</div></div>
      <div class="plan-row">
        <label class="checkbox-row"><input type="checkbox" ${st.autoFx ? 'checked' : ''} onchange="updateSetting('autoFx', this.checked)"> Actualizar el tipo de cambio USD/MXN automáticamente cada día</label>
      </div>
    </div>

    <div class="card">
      <div class="card-title-row"><div class="card-title">💾 Respaldo y Gestión de Datos</div></div>
      <p style="font-size:14px; color:var(--text-muted); margin-bottom:16px;">Tu información vive solo en este navegador. Descarga un respaldo con frecuencia: si borras los datos del navegador, se pierde.</p>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <button class="btn-submit" onclick="exportDataJSON()" style="background:var(--usd-color); margin-top:0;">💾 Descargar Respaldo (JSON)</button>
        <button class="btn-submit" onclick="exportTransactionsCSV()" style="background:var(--mxn-color); margin-top:0;">📄 Exportar Movimientos a Excel / CSV</button>
        <span class="form-hint">⚠️ El archivo de respaldo NO está cifrado (no incluye tu contraseña). Guárdalo en un lugar seguro.</span>
        <div style="margin-top:10px; padding-top:16px; border-top:1px solid var(--divider);">
          <label class="form-label" for="importFileInput">Restaurar respaldo desde archivo JSON</label>
          <input type="file" id="importFileInput" accept=".json,application/json" class="input-field" onchange="importDataJSON(event)">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title-row"><div class="card-title">📱 Instalar como App</div></div>
      <p style="font-size:13.5px; color:var(--text-muted);">
        ${location.protocol.startsWith('http')
          ? 'En el celular abre el menú del navegador y elige <b>"Agregar a pantalla de inicio"</b> / <b>"Instalar app"</b>. Funcionará sin internet.'
          : 'Para instalarla en tu celular y usarla sin internet, publica esta carpeta en un hosting gratuito con https (por ejemplo GitHub Pages o Netlify) y abre el enlace desde el celular.'}
      </p>
    </div>

    <div class="card">
      <div style="font-size:13.5px; font-weight:800; color:var(--expense); margin-bottom:8px;">Zona de Peligro</div>
      <button class="btn-submit expense" onclick="resetAllData()" style="margin-top:0;">🗑️ Borrar y Reiniciar Todos los Datos</button>
    </div>`;
}

// ==========================================
// ACCIONES: NAVEGACIÓN
// ==========================================
function setTab(t) {
  currentTab = t;
  if (t !== 'bank') selectedBankCardId = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setPeriod(p) { currentPeriod = p; render(); }
function setChartMode(m) { selectedChartMode = m; render(); }
function setGbmMarketView(v) { gbmMarketView = v; render(); }
function shiftReportMonth(d) {
  const next = shiftMonth(reportMonth || thisMonth(), d);
  if (next > thisMonth()) return;
  reportMonth = next;
  render();
}
function enterCardDetail(id) { selectedBankCardId = id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function exitCardDetail() { selectedBankCardId = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function updateSetting(key, value) {
  S.settings[key] = value;
  saveState();
  render();
}

// ==========================================
// MODALES (genérico)
// ==========================================
function openModal(id, focusId) {
  $(id).classList.add('open');
  if (focusId) setTimeout(() => { const el = $(focusId); if (el) el.focus(); }, 60);
}
function closeModal(id) { $(id).classList.remove('open'); }
function closeModalOnBg(e, id) { if (e.target.id === id) closeModal(id); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = [...document.querySelectorAll('.modal-overlay.open')];
    if (open.length) closeModal(open[open.length - 1].id);
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    e.target.click();
  }
});

// Modal genérico de un monto
let valueModalHandler = null;
function openValueModal({ title, label, hint = '', value = '', btn = 'Guardar', min = null, onSave }) {
  $('valueModalTitle').textContent = title;
  $('valueModalLabel').textContent = label;
  $('valueModalHint').textContent = hint;
  $('valueModalBtn').textContent = btn;
  const inp = $('valueInput');
  inp.value = value;
  if (min === null) inp.removeAttribute('min'); else inp.min = min;
  valueModalHandler = onSave;
  openModal('valueModal', 'valueInput');
}
function handleValueModalSubmit(e) {
  e.preventDefault();
  const v = parseFloat($('valueInput').value);
  if (isNaN(v)) return;
  closeModal('valueModal');
  if (valueModalHandler) valueModalHandler(v);
}

// ==========================================
// MOVIMIENTOS: ALTA / EDICIÓN
// ==========================================
function openTxModal(type = 'in', presetCat = null, editRec = null) {
  const editing = !!editRec;
  $('txType').value = type;
  $('txEditSrc').value = editing ? editRec.src : '';
  $('txEditId').value = editing ? editRec.id : '';
  $('txModalTitle').textContent = (editing ? 'Editar ' : 'Registrar ') + (type === 'in' ? 'Ingreso' : 'Gasto');
  $('txSubmitBtn').textContent = editing ? 'Guardar Cambios' : (type === 'in' ? 'Guardar Ingreso' : 'Guardar Gasto');
  $('txSubmitBtn').className = type === 'in' ? 'btn-submit' : 'btn-submit expense';

  const defAcct = editing ? editRec.acct : (selectedBankCardId || (S.cards[0] ? S.cards[0].id : 'cash'));
  $('txCardSelect').innerHTML = accountOptionsHtml(defAcct, { cash: true });
  $('txAmount').value = editing ? editRec.a : '';
  $('txNote').value = editing ? (editRec.n || '') : '';
  $('txDate').value = editing ? editRec.d : today();

  const cats = type === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  let sel = editing ? editRec.c : (presetCat || cats[0].name);
  if (!cats.find(c => c.name === sel) && sel !== ADJUST_CATEGORY) sel = sel || cats[0].name;
  $('txCategory').value = sel;
  const list = cats.slice();
  if (sel && !cats.find(c => c.name === sel)) list.push({ name: sel, icon: catInfo(sel).icon });
  $('txCategoryChips').innerHTML = list.map((c, i) => `
    <button type="button" class="cat-chip ${c.name === sel ? 'selected' : ''}" role="radio" aria-checked="${c.name === sel}" data-cat="${esc(c.name)}" onclick="selectCategoryChip(this)">
      <span>${c.icon}</span><span>${esc(c.name)}</span>
    </button>`).join('');

  // Impuestos
  const taxGroup = $('txTaxGroup');
  if (type === 'in' && S.settings.taxEnabled) {
    taxGroup.classList.remove('hidden');
    $('txTaxable').checked = editing ? num(editRec.tax) > 0 : defaultTaxFor(sel) > 0;
    $('txTaxLabel').textContent = `Este ingreso causa impuestos (apartar ${editing && num(editRec.tax) > 0 ? editRec.tax : S.settings.taxRate}%)`;
  } else {
    taxGroup.classList.add('hidden');
    $('txTaxable').checked = false;
  }

  $('txRecurGroup').classList.toggle('hidden', editing);
  $('txRecurring').checked = false;

  openModal('txModal', 'txAmount');
}

function openTxModalForCard(type, cardId) {
  openTxModal(type);
  $('txCardSelect').value = cardId;
}

function openEditMovement(src, id) {
  const rec = findMovement(src, id);
  if (!rec) return;
  openTxModal(rec.k, null, { src, id, acct: src === 'cash' ? 'cash' : rec.cardId, a: rec.a, n: rec.n, d: rec.d, c: rec.c, tax: rec.tax });
}

function selectCategoryChip(elem) {
  $('txCategoryChips').querySelectorAll('.cat-chip').forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-checked', 'false'); });
  elem.classList.add('selected');
  elem.setAttribute('aria-checked', 'true');
  const cat = elem.getAttribute('data-cat');
  $('txCategory').value = cat;
  if ($('txType').value === 'in' && S.settings.taxEnabled && !$('txEditId').value) {
    $('txTaxable').checked = defaultTaxFor(cat) > 0;
  }
}

function handleSaveTx(e) {
  e.preventDefault();
  const amt = parseFloat($('txAmount').value);
  if (isNaN(amt) || amt <= 0) return;
  const type = $('txType').value;
  const acct = $('txCardSelect').value;
  if (!acct) { toast('Primero agrega una tarjeta o elige efectivo.'); return; }
  const cat = $('txCategory').value;
  const date = $('txDate').value || today();
  const note = $('txNote').value.trim();
  const editSrc = $('txEditSrc').value;
  const editId = $('txEditId').value;

  let tax = 0;
  if (type === 'in' && S.settings.taxEnabled && $('txTaxable').checked) tax = num(S.settings.taxRate);

  if (acct === 'cash' && type === 'out') {
    const old = editId ? findMovement(editSrc, editId) : null;
    const giveBack = old && editSrc === 'cash' ? (old.k === 'out' ? old.a : -old.a) : 0;
    const avail = getCashStats().bal + giveBack;
    if (amt > avail + 0.001 && !confirm(`Solo tienes ${fmtMxn(avail)} en efectivo; tu saldo quedaría negativo. ¿Guardar de todos modos?`)) return;
  }

  if (editId) {
    const old = findMovement(editSrc, editId);
    if (!old) return;
    if (type === 'in' && $('txTaxable').checked && num(old.tax) > 0) tax = num(old.tax);
    removeMovement(editSrc, editId);
    addMovement({ k: type, a: amt, n: note, d: date, c: cat, acct, tax, rec: old.rec, inv: old.inv, id: old.id, ts: old.ts });
    toast('✏️ Movimiento actualizado');
  } else {
    let recId = null;
    if ($('txRecurring').checked) {
      recId = uid();
      S.recurring.push({ id: recId, k: type, a: round2(amt), n: note, c: cat, acct, freq: 'monthly', day: parseIso(date).getDate(), next: advanceDate(date, 'monthly'), active: true });
    }
    addMovement({ k: type, a: amt, n: note, d: date, c: cat, acct, tax, rec: recId });
    toast(type === 'in' ? '✅ Ingreso registrado' : '✅ Gasto registrado');
  }
  saveState();
  closeModal('txModal');
  render();
}

function deleteMovement(src, id) {
  const rec = findMovement(src, id);
  if (!rec) return;
  if (!confirm('¿Deseas eliminar este movimiento?')) return;
  if (rec.inv) {
    const inv = S.invoices.find(i => i.id === rec.inv);
    if (inv) { inv.status = 'pending'; inv.paidDate = null; inv.txRef = null; }
  }
  removeMovement(src, id);
  saveState();
  render();
  toast('🗑️ Movimiento eliminado');
}

// ==========================================
// TRANSFERENCIAS
// ==========================================
function openTransferModal(from = null, to = null, editId = null) {
  const editing = editId ? S.transfers.find(r => r.id === editId) : null;
  if (S.cards.length === 0 && !editing) {
    toast('Agrega al menos una tarjeta o cuenta para transferir.');
  }
  const defFrom = editing ? editing.from : (from || (S.cards.find(c => c.type !== 'credit' && c.id !== to) || {}).id || 'cash');
  let defTo = editing ? editing.to : (to || (defFrom === 'cash' ? (S.cards[0] || {}).id : 'cash'));
  $('trFrom').innerHTML = accountOptionsHtml(defFrom, { cash: true, gbm: true });
  $('trTo').innerHTML = accountOptionsHtml(defTo, { cash: true, gbm: true });
  if (defTo && defTo !== defFrom) $('trTo').value = defTo;
  $('trEditId').value = editing ? editing.id : '';
  $('trAmount').value = editing ? editing.a : '';
  $('trNote').value = editing ? (editing.n || '') : '';
  $('trDate').value = editing ? editing.d : today();
  $('trModalTitle').textContent = editing ? '✏️ Editar Transferencia' : '🔄 Transferir entre Cuentas';
  $('trSubmitBtn').textContent = editing ? 'Guardar Cambios' : 'Confirmar Transferencia';
  openModal('transferModal', 'trAmount');
}

function handleSaveTransfer(e) {
  e.preventDefault();
  const from = $('trFrom').value, to = $('trTo').value;
  const a = parseFloat($('trAmount').value);
  if (!from || !to) return;
  if (from === to) { toast('⚠️ El origen y el destino deben ser diferentes.'); return; }
  if (isNaN(a) || a <= 0) return;
  const d = $('trDate').value || today();
  const n = $('trNote').value.trim();
  const editId = $('trEditId').value;
  if (editId) {
    const r = S.transfers.find(x => x.id === editId);
    if (r) Object.assign(r, { from, to, a: round2(a), d, n });
  } else {
    S.transfers.push({ id: uid(), ts: Date.now(), from, to, a: round2(a), d, n });
  }
  saveState();
  closeModal('transferModal');
  render();
  toast('🔄 Transferencia guardada');
}

// ==========================================
// TARJETAS
// ==========================================
function updateCardTypeFields() {
  const credit = $('cardTypeInput').value === 'credit';
  $('creditFields').classList.toggle('hidden', !credit);
  $('cardInitialLabel').textContent = credit ? 'Deuda Actual de la Tarjeta ($ MXN)' : 'Saldo Inicial ($ MXN)';
}
function openAddCardModal() {
  $('cardEditId').value = '';
  $('cardModalTitle').textContent = 'Nueva Tarjeta / Cuenta';
  $('cardSubmitBtn').textContent = 'Crear Tarjeta';
  $('cardNameInput').value = '';
  $('cardTypeInput').value = 'debit';
  $('cardInitialInput').value = '';
  $('cardLimitInput').value = '';
  $('cardCutInput').value = '';
  $('cardPayInput').value = '';
  updateCardTypeFields();
  selectCardColor('emerald', document.querySelector('.color-option-btn[data-color="emerald"]'));
  openModal('cardModal', 'cardNameInput');
}
function openEditCardModal(cardId) {
  const c = S.cards.find(x => x.id === cardId);
  if (!c) return;
  $('cardEditId').value = c.id;
  $('cardModalTitle').textContent = 'Editar Tarjeta / Cuenta';
  $('cardSubmitBtn').textContent = 'Guardar Cambios';
  $('cardNameInput').value = c.name;
  $('cardTypeInput').value = c.type;
  $('cardInitialInput').value = c.type === 'credit' ? Math.abs(num(c.initial)) : num(c.initial);
  $('cardLimitInput').value = c.limit || '';
  $('cardCutInput').value = c.cutDay || '';
  $('cardPayInput').value = c.payDay || '';
  updateCardTypeFields();
  if (c.type === 'credit') $('cardInitialLabel').textContent = 'Deuda Inicial (al registrar la tarjeta)';
  selectCardColor(c.color, document.querySelector(`.color-option-btn[data-color="${c.color}"]`));
  openModal('cardModal', 'cardNameInput');
}
function selectCardColor(color, btn) {
  document.querySelectorAll('.color-option-btn').forEach(b => b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
  $('cardColorInput').value = color;
}
function handleSaveCard(e) {
  e.preventDefault();
  const name = $('cardNameInput').value.trim();
  if (!name) return;
  const type = $('cardTypeInput').value === 'credit' ? 'credit' : 'debit';
  const val = Math.abs(parseFloat($('cardInitialInput').value) || 0);
  const data = {
    name, type,
    initial: type === 'credit' ? -val : val,
    color: $('cardColorInput').value || 'emerald',
    limit: type === 'credit' ? (parseFloat($('cardLimitInput').value) || 0) : 0,
    cutDay: type === 'credit' ? (parseInt($('cardCutInput').value, 10) || null) : null,
    payDay: type === 'credit' ? (parseInt($('cardPayInput').value, 10) || null) : null
  };
  const editId = $('cardEditId').value;
  if (editId) {
    const c = S.cards.find(x => x.id === editId);
    if (c) Object.assign(c, data);
  } else {
    S.cards.push(Object.assign({ id: 'c_' + uid() }, data));
  }
  saveState();
  closeModal('cardModal');
  render();
  toast(editId ? '✏️ Tarjeta actualizada' : '💳 Tarjeta creada');
}
function deleteCard(cardId) {
  const c = S.cards.find(x => x.id === cardId);
  if (!c) return;
  const nTx = S.tx.filter(t => t.cardId === cardId).length;
  const nTr = S.transfers.filter(r => r.from === cardId || r.to === cardId).length;
  if (!confirm(`¿Eliminar "${c.name}" junto con sus ${nTx} movimiento(s) y ${nTr} transferencia(s)?`)) return;
  S.cards = S.cards.filter(x => x.id !== cardId);
  S.tx = S.tx.filter(t => t.cardId !== cardId);
  S.transfers = S.transfers.filter(r => r.from !== cardId && r.to !== cardId);
  S.recurring.forEach(r => { if (r.acct === cardId) r.active = false; });
  selectedBankCardId = null;
  saveState();
  render();
  toast('🗑️ Tarjeta eliminada');
}

// ==========================================
// EFECTIVO
// ==========================================
let currentCashMode = 'in';
function openCashModal(mode = 'in') {
  $('cashAmount').value = '';
  $('cashNote').value = '';
  $('cashDate').value = today();
  $('cashErrorMsg').textContent = '';
  setCashMode(mode);
  openModal('cashModal', 'cashAmount');
}
function setCashMode(mode) {
  currentCashMode = mode;
  $('cashMode').value = mode;
  $('cashTabIn').className = 'period-pill' + (mode === 'in' ? ' active' : '');
  $('cashTabOut').className = 'period-pill' + (mode === 'out' ? ' active' : '');
  $('cashTabSet').className = 'period-pill' + (mode === 'set' ? ' active' : '');
  const btn = $('cashSubmitBtn');
  $('cashErrorMsg').textContent = '';
  if (mode === 'set') {
    $('cashModalTitle').textContent = '✏️ Ajustar Saldo Total de Efectivo';
    $('cashAmountLabel').textContent = 'Nuevo Saldo Total Exacto ($ MXN)';
    btn.textContent = 'Guardar Nuevo Saldo';
    btn.className = 'btn-submit';
    $('cashPresetChips').style.display = 'none';
    $('cashCatGroup').classList.add('hidden');
  } else {
    const cats = mode === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    $('cashCategory').innerHTML = cats.map(c => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('');
    $('cashCategory').value = mode === 'in' ? 'Otros Ingresos' : 'Otros Gastos';
    $('cashCatGroup').classList.remove('hidden');
    $('cashPresetChips').style.display = 'flex';
    $('cashModalTitle').textContent = mode === 'in' ? '💵 Agregar Dinero en Efectivo' : '💸 Gastar Efectivo';
    $('cashAmountLabel').textContent = mode === 'in' ? 'Monto a Sumar ($ MXN)' : 'Monto a Restar ($ MXN)';
    btn.textContent = mode === 'in' ? 'Confirmar Entrada' : 'Confirmar Gasto';
    btn.className = mode === 'in' ? 'btn-submit' : 'btn-submit expense';
  }
  updateCashPreview();
}
function applyCashPreset(amt) {
  const cur = parseFloat($('cashAmount').value) || 0;
  $('cashAmount').value = currentCashMode === 'set' ? amt : cur + amt;
  updateCashPreview();
}
function updateCashPreview() {
  const bal = getCashStats().bal;
  const amt = parseFloat($('cashAmount').value) || 0;
  let nb = bal;
  const ch = $('cashPreviewChange');
  if (currentCashMode === 'in') {
    nb = bal + amt; $('cashPreviewOpLabel').textContent = 'Monto a Sumar:'; ch.textContent = `+${fmtMxn(amt)}`; ch.style.color = 'var(--income)';
  } else if (currentCashMode === 'out') {
    nb = bal - amt; $('cashPreviewOpLabel').textContent = 'Monto a Restar:'; ch.textContent = `-${fmtMxn(amt)}`; ch.style.color = 'var(--expense)';
  } else {
    nb = $('cashAmount').value === '' ? bal : amt; $('cashPreviewOpLabel').textContent = 'Diferencia:'; ch.textContent = `${nb - bal >= 0 ? '+' : ''}${fmtMxn(nb - bal)}`; ch.style.color = 'var(--usd-color)';
  }
  $('cashPreviewCurrent').textContent = fmtMxn(bal);
  $('cashPreviewResult').textContent = fmtMxn(nb);
  $('cashPreviewResult').style.color = nb < 0 ? 'var(--expense)' : 'var(--primary)';
}
function handleSaveCash(e) {
  e.preventDefault();
  const amt = parseFloat($('cashAmount').value);
  if (isNaN(amt) || amt < 0) return;
  const mode = $('cashMode').value;
  const note = $('cashNote').value.trim();
  const date = $('cashDate').value || today();
  const bal = getCashStats().bal;

  if (mode === 'set') {
    const diff = round2(amt - bal);
    if (diff !== 0) addMovement({ k: diff > 0 ? 'in' : 'out', a: Math.abs(diff), n: note || 'Ajuste de saldo de efectivo', d: date, c: ADJUST_CATEGORY, acct: 'cash' });
  } else {
    if (amt <= 0) return;
    if (mode === 'out' && amt > bal + 0.001) {
      $('cashErrorMsg').textContent = `❌ Solo tienes ${fmtMxn(bal)} en efectivo. Si tu saldo real es otro, usa "Ajustar Total".`;
      return;
    }
    const cat = $('cashCategory').value;
    addMovement({ k: mode, a: amt, n: note || (mode === 'in' ? 'Ingreso en efectivo' : 'Gasto en efectivo'), d: date, c: cat, acct: 'cash', tax: mode === 'in' ? defaultTaxFor(cat) : 0 });
  }
  saveState();
  closeModal('cashModal');
  render();
  toast('💵 Efectivo actualizado');
}

// ==========================================
// GBM: CAPITAL, LÍQUIDO, ACCIONES
// ==========================================
function setInitialInvested(preset) {
  const v = preset !== undefined ? preset : parseFloat($('initInvestedInput').value);
  if (isNaN(v) || v < 0) { toast('Ingresa un monto válido.'); return; }
  S.invested = v;
  saveState();
  render();
}

let currentGbmCapMode = 'deposit';
function openGbmCapitalModal(mode = 'deposit') {
  $('gbmCapitalAmount').value = '';
  setGbmCapitalMode(mode);
  openModal('gbmCapitalModal', 'gbmCapitalAmount');
}
function setGbmCapitalMode(mode) {
  currentGbmCapMode = mode;
  $('gbmCapitalMode').value = mode;
  $('gbmCapTabDeposit').className = 'period-pill' + (mode === 'deposit' ? ' active' : '');
  $('gbmCapTabWithdraw').className = 'period-pill' + (mode === 'withdraw' ? ' active' : '');
  $('gbmCapTabSet').className = 'period-pill' + (mode === 'set' ? ' active' : '');
  const btn = $('gbmCapitalSubmitBtn');
  const srcGroup = $('gbmCapSourceGroup');
  if (mode === 'set') {
    srcGroup.classList.add('hidden');
    $('gbmCapitalModalTitle').textContent = '✏️ Ajustar Capital Total Depositado';
    $('gbmCapitalInputLabel').textContent = 'Capital Total Depositado Exacto ($ MXN)';
    btn.textContent = 'Guardar Nuevo Capital';
    btn.className = 'btn-submit';
    $('gbmPresetChips').style.display = 'none';
  } else {
    srcGroup.classList.remove('hidden');
    const firstDebit = (S.cards.find(c => c.type !== 'credit') || {}).id || '';
    $('gbmCapSource').innerHTML = accountOptionsHtml(firstDebit, { cash: true, blank: 'Solo registrar (sin mover dinero de otra cuenta)' });
    $('gbmCapSourceLabel').textContent = mode === 'deposit' ? '¿De dónde sale el dinero?' : '¿A dónde llega el dinero?';
    $('gbmCapitalModalTitle').textContent = mode === 'deposit' ? '📥 Depositar a GBM' : '📤 Retirar de GBM';
    $('gbmCapitalInputLabel').textContent = mode === 'deposit' ? 'Monto a Depositar ($ MXN)' : 'Monto a Retirar ($ MXN)';
    btn.textContent = mode === 'deposit' ? 'Confirmar Depósito' : 'Confirmar Retiro';
    btn.className = mode === 'deposit' ? 'btn-submit' : 'btn-submit expense';
    $('gbmPresetChips').style.display = 'flex';
  }
  updateGbmCapitalPreview();
}
function applyGbmCapitalPreset(amt) {
  const cur = parseFloat($('gbmCapitalAmount').value) || 0;
  $('gbmCapitalAmount').value = currentGbmCapMode === 'set' ? amt : cur + amt;
  updateGbmCapitalPreview();
}
function updateGbmCapitalPreview() {
  const cur = getGbmStats().totalInvestedMxn;
  const amt = parseFloat($('gbmCapitalAmount').value) || 0;
  let nv = cur;
  const ch = $('gbmCapPreviewChange');
  if (currentGbmCapMode === 'deposit') { nv = cur + amt; $('gbmCapPreviewOpLabel').textContent = 'Aporte a Sumar:'; ch.textContent = `+${fmtMxn(amt)}`; ch.style.color = 'var(--income)'; }
  else if (currentGbmCapMode === 'withdraw') { nv = Math.max(0, cur - amt); $('gbmCapPreviewOpLabel').textContent = 'Retiro a Restar:'; ch.textContent = `-${fmtMxn(amt)}`; ch.style.color = 'var(--expense)'; }
  else { nv = $('gbmCapitalAmount').value === '' ? cur : amt; $('gbmCapPreviewOpLabel').textContent = 'Diferencia:'; ch.textContent = fmtMxn(nv - cur); ch.style.color = 'var(--usd-color)'; }
  $('gbmCapPreviewCurrent').textContent = fmtMxn(cur);
  $('gbmCapPreviewResult').textContent = fmtMxn(nv);
}
function handleSaveGbmCapital(e) {
  e.preventDefault();
  const amt = parseFloat($('gbmCapitalAmount').value);
  if (isNaN(amt) || amt < 0) return;
  if (S.invested === null) S.invested = 0;
  const mode = currentGbmCapMode;
  if (mode === 'set') {
    S.invested = amt - transferNet('gbm');
  } else {
    if (amt <= 0) return;
    const acct = $('gbmCapSource').value;
    if (acct) {
      if (mode === 'withdraw' && amt > gbmLiquid() + 0.001 &&
        !confirm(`Tu saldo líquido en GBM es ${fmtMxn(gbmLiquid())}. ¿Registrar el retiro de todos modos?`)) return;
      S.transfers.push({
        id: uid(), ts: Date.now(),
        from: mode === 'deposit' ? acct : 'gbm',
        to: mode === 'deposit' ? 'gbm' : acct,
        a: round2(amt), d: today(),
        n: mode === 'deposit' ? 'Depósito a GBM' : 'Retiro de GBM'
      });
    } else {
      S.invested = mode === 'deposit' ? num(S.invested) + amt : num(S.invested) - amt;
      if (investedTotal() < 0) S.invested = -transferNet('gbm');
    }
  }
  saveState();
  closeModal('gbmCapitalModal');
  render();
  toast('📈 Capital GBM actualizado');
}

function openLiquidAdjust() {
  const cur = gbmLiquid();
  openValueModal({
    title: '💵 Ajustar Saldo Líquido GBM',
    label: 'Saldo líquido real en tu cuenta GBM ($ MXN)',
    hint: `Actual registrado: ${fmtMxn(cur)}. Es el dinero en GBM que no está invertido en acciones.`,
    value: round2(cur),
    onSave: v => {
      S.gbmCashBase = num(S.gbmCashBase) + (v - gbmLiquid());
      saveState(); render(); toast('💵 Saldo líquido actualizado');
    }
  });
}

function updateStockModalLabel() {
  const cur = $('stockCurrency').value;
  $('stockBuyPriceLabel').textContent = `Precio (${cur})`;
}
function openStockModal(currency = 'USD', stockId = null, lotIdx = null) {
  const s = stockId ? S.stocks.find(x => x.id === stockId) : null;
  const editingLot = s && lotIdx !== null && lotIdx !== undefined;
  const lot = editingLot ? s.lots[lotIdx] : null;
  $('stockEditId').value = s ? s.id : '';
  $('stockEditLot').value = editingLot ? lotIdx : '';
  $('stockCurrency').value = s ? s.c : currency;
  $('stockCurrency').disabled = !!s;
  $('stockTicker').value = s ? s.t : '';
  $('stockTicker').readOnly = !!s && !editingLot;
  $('stockShares').value = lot ? lot.q : '';
  $('stockBuyPrice').value = lot ? lot.b : '';
  $('stockDate').value = lot && lot.d ? lot.d : today();
  $('stockPayLiquid').checked = lot ? num(lot.paid) > 0 : false;
  $('stockModalTitle').textContent = editingLot ? `✏️ Editar compra de ${s.t}` : s ? `＋ Nueva compra de ${s.t}` : 'Agregar Compra de Acción / ETF';
  $('stockSubmitBtn').textContent = editingLot ? 'Guardar Cambios' : 'Guardar en Portafolio';
  updateStockModalLabel();
  openModal('stockModal', s ? 'stockShares' : 'stockTicker');
}
function handleSaveStock(e) {
  e.preventDefault();
  const cur = $('stockCurrency').value;
  const ticker = $('stockTicker').value.trim().toUpperCase();
  const q = parseFloat($('stockShares').value);
  const b = parseFloat($('stockBuyPrice').value);
  const d = $('stockDate').value || today();
  if (!ticker || isNaN(q) || q <= 0 || isNaN(b) || b <= 0) return;
  const paid = $('stockPayLiquid').checked ? round2(q * b * fxMult(cur)) : 0;
  const editId = $('stockEditId').value;
  const lotIdx = $('stockEditLot').value;

  if (editId && lotIdx !== '') {
    const s = S.stocks.find(x => x.id === editId);
    if (!s || !s.lots[+lotIdx]) return;
    s.t = ticker;
    s.lots[+lotIdx] = { q, b, d, paid };
  } else {
    let s = editId ? S.stocks.find(x => x.id === editId) : S.stocks.find(x => x.t === ticker && x.c === cur);
    if (!s) {
      s = { id: uid(), t: ticker, c: cur, p: b, lots: [], sales: [] };
      S.stocks.push(s);
    }
    s.lots.push({ q, b, d, paid });
  }
  $('stockCurrency').disabled = false;
  saveState();
  closeModal('stockModal');
  render();
  toast('📈 Compra guardada');
}
function updateStockPrice(id, val) {
  const p = parseFloat(val);
  const s = S.stocks.find(x => x.id === id);
  if (!s || isNaN(p) || p < 0) return;
  s.p = p;
  saveState();
  render();
}
function toggleStockHistory(id) { expandedStocks[id] = !expandedStocks[id]; render(); }
function deleteStock(id) {
  const s = S.stocks.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`¿Eliminar ${s.t} con todo su historial de compras, ventas y dividendos?`)) return;
  S.stocks = S.stocks.filter(x => x.id !== id);
  S.dividends = S.dividends.filter(d => d.stockId !== id);
  saveState(); render();
}
function deleteLot(id, idx) {
  const s = S.stocks.find(x => x.id === id);
  if (!s || !confirm('¿Eliminar esta compra?')) return;
  s.lots.splice(idx, 1);
  saveState(); render();
}

function openSellModal(id) {
  const s = S.stocks.find(x => x.id === id);
  if (!s) return;
  const q = stockQty(s);
  $('sellStockId').value = id;
  $('sellModalTitle').textContent = `− Vender ${s.t}`;
  $('sellShares').value = '';
  $('sellShares').max = q;
  $('sellMaxHint').textContent = `Tienes ${fmtQty(q)} títulos · Promedio ${fmtCur(stockAvg(s), s.c)}`;
  $('sellPriceLabel').textContent = `Precio de venta (${s.c})`;
  $('sellPrice').value = num(s.p) || '';
  $('sellDate').value = today();
  $('sellToLiquid').checked = true;
  openModal('sellModal', 'sellShares');
}
function handleSaveSell(e) {
  e.preventDefault();
  const s = S.stocks.find(x => x.id === $('sellStockId').value);
  if (!s) return;
  const q = parseFloat($('sellShares').value);
  const price = parseFloat($('sellPrice').value);
  const have = stockQty(s);
  if (isNaN(q) || q <= 0 || isNaN(price) || price <= 0) return;
  if (q > have + 1e-9) { toast(`⚠️ Solo tienes ${fmtQty(have)} títulos.`); return; }
  const avg = stockAvg(s);
  const remaining = have - q;
  const paidTotal = s.lots.reduce((a, l) => a + num(l.paid), 0);
  const firstDate = s.lots.map(l => l.d).filter(Boolean).sort()[0] || null;
  // Mantener el costo promedio para los títulos restantes
  s.lots = remaining > 1e-9 ? [{ q: remaining, b: avg, d: firstDate, paid: round2(paidTotal * remaining / have) }] : [];
  s.sales.push({
    id: uid(), q, price, avg, d: $('sellDate').value || today(),
    mxn: round2(q * price * fxMult(s.c)),
    gain: (price - avg) * q,
    liquid: $('sellToLiquid').checked,
    paidRemoved: round2(paidTotal - (remaining > 1e-9 ? paidTotal * remaining / have : 0))
  });
  saveState();
  closeModal('sellModal');
  render();
  toast('💰 Venta registrada');
}
function deleteSale(stockId, saleId) {
  const s = S.stocks.find(x => x.id === stockId);
  if (!s) return;
  const x = s.sales.find(v => v.id === saleId);
  if (!x || !confirm('¿Deshacer esta venta? Los títulos regresarán a tu posición.')) return;
  s.lots.push({ q: x.q, b: x.avg, d: x.d, paid: num(x.paidRemoved) });
  s.sales = s.sales.filter(v => v.id !== saleId);
  saveState(); render();
}

function openDividendModal(stockId = null) {
  const open = S.stocks;
  if (!open.length) { toast('Primero agrega una acción a tu portafolio.'); return; }
  $('divStock').innerHTML = open.map(s => `<option value="${s.id}" ${s.id === stockId ? 'selected' : ''}>${esc(s.t)} (${s.c})</option>`).join('');
  $('divAmount').value = '';
  $('divDate').value = today();
  updateDividendLabel();
  openModal('dividendModal', 'divAmount');
}
function updateDividendLabel() {
  const s = S.stocks.find(x => x.id === $('divStock').value);
  $('divAmountLabel').textContent = `Monto neto recibido (${s ? s.c : 'USD'})`;
}
function handleSaveDividend(e) {
  e.preventDefault();
  const s = S.stocks.find(x => x.id === $('divStock').value);
  const a = parseFloat($('divAmount').value);
  if (!s || isNaN(a) || a <= 0) return;
  S.dividends.push({ id: uid(), stockId: s.id, t: s.t, c: s.c, a, mxn: round2(a * fxMult(s.c)), d: $('divDate').value || today() });
  saveState();
  closeModal('dividendModal');
  render();
  toast('💰 Dividendo registrado');
}
function deleteDividend(id) {
  if (!confirm('¿Eliminar este dividendo?')) return;
  S.dividends = S.dividends.filter(d => d.id !== id);
  saveState(); render();
}

// ---------- Tipo de cambio ----------
function updateFxRate(val) {
  const x = parseFloat(val);
  if (isNaN(x) || x <= 0) return;
  S.fx = x;
  S.fxd = today();
  saveState();
  render();
}

async function fetchJson(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function refreshFx(silent) {
  const btn = $('fxAutoBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Consultando…'; }
  const sources = [
    ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN', j => j && j.rates && j.rates.MXN],
    ['https://api.frankfurter.app/latest?from=USD&to=MXN', j => j && j.rates && j.rates.MXN],
    ['https://open.er-api.com/v6/latest/USD', j => j && j.rates && j.rates.MXN]
  ];
  let rate = null;
  for (const [url, pick] of sources) {
    try { rate = num(pick(await fetchJson(url))); if (rate > 0) break; } catch (e) { rate = null; }
  }
  if (!isAuthenticated) return;
  if (rate > 0) {
    S.fx = Math.round(rate * 10000) / 10000;
    S.fxd = today();
    saveState();
    render();
    if (!silent) toast(`💱 Tipo de cambio actualizado: $${S.fx} MXN`);
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar automático'; }
    if (!silent) toast('⚠️ No se pudo obtener el tipo de cambio. Revisa tu conexión.');
  }
}

// ==========================================
// PLANEACIÓN: FACTURAS, RECURRENTES, PRESUPUESTOS, METAS
// ==========================================
function openInvoiceModal(id = null) {
  const inv = id ? S.invoices.find(i => i.id === id) : null;
  const due = new Date(); due.setDate(due.getDate() + 30);
  $('invEditId').value = inv ? inv.id : '';
  $('invModalTitle').textContent = inv ? '✏️ Editar Cuenta por Cobrar' : '🧾 Nueva Cuenta por Cobrar';
  $('invClient').value = inv ? inv.client : '';
  $('invConcept').value = inv ? (inv.concept || '') : '';
  $('invAmount').value = inv ? inv.a : '';
  $('invIssued').value = inv ? inv.issued : today();
  $('invDue').value = inv ? inv.due : iso(due);
  const defAcct = inv ? inv.acct : ((S.cards.find(c => c.type !== 'credit') || {}).id || 'cash');
  $('invAccount').innerHTML = accountOptionsHtml(defAcct, { cash: true });
  $('invCategory').innerHTML = INCOME_CATEGORIES.map(c => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('');
  $('invCategory').value = inv ? inv.cat : 'Cliente Freelance';
  openModal('invoiceModal', 'invClient');
}
function handleSaveInvoice(e) {
  e.preventDefault();
  const a = parseFloat($('invAmount').value);
  const client = $('invClient').value.trim();
  if (!client || isNaN(a) || a <= 0) return;
  const data = {
    client, concept: $('invConcept').value.trim(), a: round2(a),
    issued: $('invIssued').value || today(), due: $('invDue').value || today(),
    acct: $('invAccount').value || 'cash', cat: $('invCategory').value
  };
  if (data.due < data.issued) { toast('⚠️ El vencimiento no puede ser antes de la emisión.'); return; }
  const id = $('invEditId').value;
  if (id) { const inv = S.invoices.find(i => i.id === id); if (inv) Object.assign(inv, data); }
  else S.invoices.push(Object.assign({ id: uid(), status: 'pending' }, data));
  saveState(); closeModal('invoiceModal'); render();
  toast('🧾 Factura guardada');
}
function markInvoicePaid(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv) return;
  if (!confirm(`¿Registrar el cobro de ${fmtMxn(inv.a)} de ${inv.client} en ${accountName(inv.acct)} con fecha de hoy?`)) return;
  const acct = inv.acct === 'cash' || S.cards.find(c => c.id === inv.acct) ? inv.acct : (S.cards[0] ? S.cards[0].id : 'cash');
  inv.txRef = addMovement({ k: 'in', a: inv.a, n: `Cobro ${inv.client}${inv.concept ? ' · ' + inv.concept : ''}`, d: today(), c: inv.cat, acct, tax: defaultTaxFor(inv.cat), inv: inv.id });
  inv.status = 'paid';
  inv.paidDate = today();
  saveState(); render();
  toast('✅ Cobro registrado como ingreso');
}
function markInvoiceUnpaid(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv || !confirm('¿Deshacer el cobro? Se eliminará el ingreso registrado.')) return;
  S.tx = S.tx.filter(t => t.inv !== id);
  S.cashTx = S.cashTx.filter(t => t.inv !== id);
  inv.status = 'pending'; inv.paidDate = null; inv.txRef = null;
  saveState(); render();
}
function deleteInvoice(id) {
  if (!confirm('¿Eliminar esta cuenta por cobrar?')) return;
  S.invoices = S.invoices.filter(i => i.id !== id);
  saveState(); render();
}

function fillRecCategories(selected) {
  const cats = $('recType').value === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  $('recCategory').innerHTML = cats.map(c => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('');
  $('recCategory').value = selected && cats.find(c => c.name === selected) ? selected : cats[0].name;
}
function openRecurringModal(id = null) {
  const r = id ? S.recurring.find(x => x.id === id) : null;
  $('recEditId').value = r ? r.id : '';
  $('recModalTitle').textContent = r ? '✏️ Editar Recurrente' : '🔁 Nuevo Movimiento Recurrente';
  $('recType').value = r ? r.k : 'out';
  $('recFreq').value = r ? r.freq : 'monthly';
  $('recNote').value = r ? r.n : '';
  $('recAmount').value = r ? r.a : '';
  $('recAccount').innerHTML = accountOptionsHtml(r ? r.acct : (S.cards[0] ? S.cards[0].id : 'cash'), { cash: true });
  fillRecCategories(r ? r.c : null);
  $('recNext').value = r ? r.next : today();
  openModal('recurringModal', 'recNote');
}
function handleSaveRecurring(e) {
  e.preventDefault();
  const a = parseFloat($('recAmount').value);
  const n = $('recNote').value.trim();
  const next = $('recNext').value;
  if (!n || isNaN(a) || a <= 0 || !next) return;
  const data = { k: $('recType').value, a: round2(a), n, c: $('recCategory').value, acct: $('recAccount').value || 'cash', freq: $('recFreq').value, next, day: parseIso(next).getDate() };
  const id = $('recEditId').value;
  if (id) { const r = S.recurring.find(x => x.id === id); if (r) Object.assign(r, data); }
  else S.recurring.push(Object.assign({ id: uid(), active: true }, data));
  const created = processRecurring();
  saveState(); closeModal('recurringModal'); render();
  toast(created ? `🔁 Guardado · ${created} movimiento(s) registrados` : '🔁 Recurrente guardado');
}
function toggleRecurring(id) {
  const r = S.recurring.find(x => x.id === id);
  if (!r) return;
  r.active = !r.active;
  if (r.active && r.next < today() && confirm('La próxima fecha ya pasó. ¿Moverla a hoy para no registrar pagos atrasados?')) r.next = today();
  const created = r.active ? processRecurring() : 0;
  saveState(); render();
  if (created) toast(`🔁 ${created} movimiento(s) registrados`);
}
function deleteRecurring(id) {
  if (!confirm('¿Eliminar este recurrente? Los movimientos ya registrados se conservan.')) return;
  S.recurring = S.recurring.filter(x => x.id !== id);
  saveState(); render();
}

function setBudget(catIdx, val) {
  const cat = EXPENSE_CATEGORIES[catIdx];
  if (!cat) return;
  const v = parseFloat(val);
  if (isNaN(v) || v <= 0) delete S.budgets[cat.name];
  else S.budgets[cat.name] = round2(v);
  saveState(); render();
}

function openGoalModal(id = null) {
  const g = id ? S.goals.find(x => x.id === id) : null;
  $('goalEditId').value = g ? g.id : '';
  $('goalModalTitle').textContent = g ? '✏️ Editar Meta' : '🎯 Nueva Meta de Ahorro';
  $('goalName').value = g ? g.name : '';
  $('goalTarget').value = g ? g.target : '';
  $('goalSaved').value = g ? g.saved : 0;
  $('goalDue').value = g ? (g.due || '') : '';
  openModal('goalModal', 'goalName');
}
function handleSaveGoal(e) {
  e.preventDefault();
  const name = $('goalName').value.trim();
  const target = parseFloat($('goalTarget').value);
  if (!name || isNaN(target) || target <= 0) return;
  const data = { name, target: round2(target), saved: round2(Math.max(0, parseFloat($('goalSaved').value) || 0)), due: $('goalDue').value || null };
  const id = $('goalEditId').value;
  if (id) { const g = S.goals.find(x => x.id === id); if (g) Object.assign(g, data); }
  else S.goals.push(Object.assign({ id: uid() }, data));
  saveState(); closeModal('goalModal'); render();
  toast('🎯 Meta guardada');
}
function contributeGoal(id) {
  const g = S.goals.find(x => x.id === id);
  if (!g) return;
  openValueModal({
    title: `＋ Abonar a "${g.name}"`,
    label: 'Monto a abonar ($ MXN)',
    hint: 'Usa un número negativo si sacaste dinero de esta meta.',
    btn: 'Guardar Abono',
    onSave: v => {
      const before = g.saved;
      g.saved = round2(Math.max(0, g.saved + v));
      saveState(); render();
      if (before < g.target && g.saved >= g.target) toast(`🏆 ¡Meta "${g.name}" cumplida!`, 4000);
      else toast('🎯 Abono registrado');
    }
  });
}
function deleteGoal(id) {
  if (!confirm('¿Eliminar esta meta?')) return;
  S.goals = S.goals.filter(x => x.id !== id);
  saveState(); render();
}

// ==========================================
// AUTENTICACIÓN
// ==========================================
async function handleAuth(e) {
  e.preventDefault();
  const pass = $('lockPassInput').value.trim();
  const err = $('lockErrorMsg');
  const btn = $('lockSubmitBtn');
  const setLoading = on => { if (btn) { btn.disabled = on; if (on) btn.textContent = '⏳ Verificando…'; } };
  unlockedSnapshot = null;
  // Con sincronización activa: traer primero la versión más reciente de la nube
  if (typeof cloudBeforeUnlock === 'function' && typeof Cloud !== 'undefined' && Cloud.user) {
    setLoading(true);
    await cloudBeforeUnlock();
  }
  const vault = readVault();
  const legacy = readLegacy();
  const wrong = () => {
    setLoading(false);
    render();
    const e2 = $('lockErrorMsg');
    if (e2) e2.textContent = '❌ Contraseña incorrecta. Toca "Ver pista" para recordarla.';
  };

  try {
    if (vault) {
      setLoading(true);
      if (vault.plain) {
        if (pass !== vault.pass) return wrong();
        session = { key: null, salt: null, iter: 0, hint: vault.hint || '', plain: true, pass };
        S = normalizeState(JSON.parse(vault.data));
      } else {
        if (!hasCrypto) { err.textContent = '⚠️ Abre la app desde el archivo local o https para descifrar tus datos.'; setLoading(false); return; }
        const salt = b64ToBuf(vault.salt);
        const iter = vault.iter || PBKDF2_ITER;
        const key = await deriveKey(pass, salt, iter);
        let json;
        try { json = await decryptText(key, vault.iv, vault.ct); } catch (x) { return wrong(); }
        session = { key, salt, iter, hint: vault.hint || '', plain: false, pass: null };
        S = normalizeState(JSON.parse(json));
        unlockedSnapshot = JSON.stringify(S);
      }
    } else if (legacy && legacy.pass) {
      // Migración del formato anterior (contraseña en texto plano)
      if (pass !== String(legacy.pass).trim()) return wrong();
      setLoading(true);
      await createSession(pass, legacy.passHint || '');
      S = normalizeState(legacy);
      isAuthenticated = true;
      await persist();
      if (readVault()) localStorage.removeItem(LEGACY_KEY);
      toast('🔐 Tus datos ahora están cifrados', 4000);
    } else {
      // Primer uso
      const confirmP = ($('lockPassConfirm') || {}).value || '';
      const hint = (($('lockPassHint') || {}).value || '').trim();
      if (pass.length < 4) { err.textContent = '⚠️ La contraseña debe tener al menos 4 caracteres.'; return; }
      if (pass !== confirmP.trim()) { err.textContent = '❌ Las contraseñas no coinciden.'; $('lockPassConfirm').value = ''; $('lockPassConfirm').focus(); return; }
      if (!hint) { err.textContent = '⚠️ La pista es obligatoria.'; $('lockPassHint').focus(); return; }
      if (hint.toLowerCase().includes(pass.toLowerCase())) { err.textContent = '⚠️ La pista no debe contener la contraseña.'; $('lockPassHint').focus(); return; }
      setLoading(true);
      await createSession(pass, hint);
      S = normalizeState(legacy || {});
      isAuthenticated = true;
      await persist();
      if (legacy && readVault()) localStorage.removeItem(LEGACY_KEY);
    }
  } catch (x) {
    console.error(x);
    setLoading(false);
    err.textContent = '⚠️ Error al abrir tus datos: ' + (x && x.message ? x.message : x);
    return;
  }
  onUnlocked();
}

function onUnlocked() {
  isAuthenticated = true;
  lastActivity = Date.now();
  reportMonth = thisMonth();
  if (typeof cloudAfterUnlock === 'function') cloudAfterUnlock(unlockedSnapshot);
  const created = processRecurring();
  saveState();
  render();
  if (created) toast(`🔁 Se registraron ${created} movimiento(s) recurrente(s)`, 4000);
  if (S.settings.autoFx && S.fxd !== today() && navigator.onLine !== false) refreshFx(true);
}

async function lockSession() {
  if (!isAuthenticated) return;
  await saveChain;
  if (typeof cloudOnLock === 'function') cloudOnLock();
  S = defaultState();
  session = emptySession();
  isAuthenticated = false;
  selectedBankCardId = null;
  closeAllModals();
  render();
}

function togglePassVisibility(id, btn) {
  const inp = $(id);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁️';
}

function showPasswordHintModal() {
  const vault = readVault();
  const legacy = readLegacy();
  const hint = vault ? vault.hint : (legacy ? legacy.passHint : '');
  $('hintModalText').innerHTML = hint
    ? `💡 "${esc(hint)}"`
    : `<span style="color:var(--text-muted); font-size:14px;">No configuraste una pista.</span>`;
  openModal('hintModal');
}

function openChangePassModal() {
  ['cpCurrentPass', 'cpNewPass', 'cpConfirmPass'].forEach(id => { $(id).value = ''; });
  $('cpHintInput').value = session.hint || '';
  $('cpErrorMsg').textContent = '';
  openModal('changePassModal', 'cpCurrentPass');
}

async function handleSaveNewPassword(e) {
  e.preventDefault();
  const cur = $('cpCurrentPass').value.trim();
  const np = $('cpNewPass').value.trim();
  const cp = $('cpConfirmPass').value.trim();
  const hint = $('cpHintInput').value.trim();
  const err = $('cpErrorMsg');
  const btn = $('cpSubmitBtn');

  // Verificar contraseña actual
  let ok = false;
  const vault = readVault();
  if (session.plain) ok = cur === session.pass;
  else if (vault && hasCrypto) {
    try {
      const key = await deriveKey(cur, b64ToBuf(vault.salt), vault.iter || PBKDF2_ITER);
      await decryptText(key, vault.iv, vault.ct);
      ok = true;
    } catch (x) { ok = false; }
  }
  if (!ok) { err.textContent = '❌ La contraseña actual no es correcta.'; $('cpCurrentPass').focus(); return; }
  if (np.length < 4) { err.textContent = '⚠️ La nueva contraseña debe tener al menos 4 caracteres.'; return; }
  if (np !== cp) { err.textContent = '❌ Las nuevas contraseñas no coinciden.'; return; }
  if (!hint) { err.textContent = '⚠️ La pista es obligatoria.'; return; }
  if (hint.toLowerCase().includes(np.toLowerCase())) { err.textContent = '⚠️ La pista no debe contener la contraseña.'; return; }

  btn.disabled = true;
  btn.textContent = '⏳ Cifrando…';
  await saveChain;
  if (typeof cloudRememberKey === 'function') cloudRememberKey();
  await createSession(np, hint);
  await persist();
  btn.disabled = false;
  btn.textContent = 'Guardar Nueva Contraseña & Pista';
  closeModal('changePassModal');
  render();
  toast('🔐 Contraseña y pista actualizadas');
}

// Bloqueo automático
let lastActivity = Date.now();
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(ev =>
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if (!isAuthenticated) return;
  const min = num(S.settings.autoLockMin);
  if (min > 0 && Date.now() - lastActivity > min * 60000) {
    lockSession();
    toast('🔒 Sesión bloqueada por inactividad');
  }
}, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isAuthenticated && S.settings.lockOnHide) lockSession();
});
window.addEventListener('beforeunload', () => { /* los guardados son inmediatos */ });

// ==========================================
// RESPALDO / EXPORTAR / IMPORTAR / REINICIAR
// ==========================================
function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportDataJSON() {
  downloadBlob(JSON.stringify(S, null, 2), 'application/json', `budget_control_respaldo_${today()}.json`);
  toast('💾 Respaldo descargado');
}

function exportTransactionsCSV() {
  const q = v => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  let csv = '﻿Tipo,Fecha,Concepto,Cuenta,Destino,Categoria,Monto_MXN,Impuesto_%\n';
  allMovements().sort(sortAsc).forEach(m => {
    const tipo = m.src === 'tr' ? 'Transferencia' : m.k === 'in' ? 'Ingreso' : 'Gasto';
    const cuenta = m.src === 'tr' ? accountName(m.from) : accountName(m.acct);
    const destino = m.src === 'tr' ? accountName(m.to) : '';
    const monto = m.src === 'tr' ? m.a : (m.k === 'in' ? m.a : -m.a);
    csv += [q(tipo), q(m.d), q(m.n), q(cuenta), q(destino), q(m.c || ''), monto, m.tax || ''].join(',') + '\n';
  });
  downloadBlob(csv, 'text/csv;charset=utf-8', `movimientos_${today()}.csv`);
  toast('📄 CSV descargado');
}

function importDataJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const imported = JSON.parse(evt.target.result);
      const valid = imported && typeof imported === 'object' &&
        ['cards', 'tx', 'cashTx', 'stocks', 'budget', 'transfers'].some(k => imported[k] !== undefined);
      if (!valid) { toast('⚠️ El archivo no tiene el formato correcto.'); return; }
      if (!confirm('Esto REEMPLAZARÁ todos tus datos actuales por los del respaldo. Tu contraseña actual se conserva. ¿Continuar?')) { e.target.value = ''; return; }
      S = normalizeState(imported);
      processRecurring();
      saveState();
      render();
      toast('✅ Datos restaurados con éxito', 3500);
    } catch (err) {
      toast('⚠️ Error al leer el archivo JSON.');
    }
  };
  reader.readAsText(file);
}

async function resetAllData() {
  if (!confirm('⚠️ ¿Seguro que deseas BORRAR TODOS los datos y la contraseña? Esta acción no se puede deshacer.')) return;
  if (!confirm('Última confirmación: ¿descargaste un respaldo? Presiona Aceptar para borrar todo.')) return;
  await saveChain;
  if (typeof cloudBeforeReset === 'function') await cloudBeforeReset();
  try { localStorage.removeItem(VAULT_KEY); localStorage.removeItem(LEGACY_KEY); } catch (x) {}
  S = defaultState();
  session = emptySession();
  isAuthenticated = false;
  selectedBankCardId = null;
  currentTab = 'overview';
  closeAllModals();
  render();
}

// Funciones antiguas mantenidas por compatibilidad
function editInvestedPrompt() { openGbmCapitalModal('set'); }

// ==========================================
// PWA (solo funciona al servir por http/https)
// ==========================================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
  });
}

// Iniciar
render();
