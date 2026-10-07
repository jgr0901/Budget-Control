/**
 * BUDGET CONTROL · Sincronización con Supabase
 * - Solo se sube la "bóveda" YA CIFRADA (AES-256). Supabase nunca ve tus datos ni tu contraseña.
 * - Cambios en tiempo real entre dispositivos (Supabase Realtime).
 * - Si dos dispositivos editan a la vez (o uno estuvo sin internet) los cambios se combinan por registro.
 */
'use strict';

const FORCE_UPLOAD_KEY = 'bc_force_upload';

const Cloud = {
  client: null,
  user: null,
  rev: 0,              // versión del servidor sobre la que se basa nuestra copia
  baseJson: null,      // último estado sincronizado (texto plano, solo en memoria)
  baseEnc: null,       // el mismo estado, cifrado (para guardarlo localmente)
  forceUpload: false,  // subir los datos de este dispositivo y reemplazar la nube
  altKeys: {},         // claves anteriores (tras cambiar contraseña)
  channel: null,
  status: 'off',
  lastSync: null,
  lastError: '',
  busy: false,
  pending: false,
  timer: null,
  ready: Promise.resolve()
};

function cloudConfigured() {
  const c = window.BC_CLOUD || {};
  return !!(c.url && c.anonKey && !/TU-PROYECTO|TU-ANON-KEY/.test(c.url + c.anonKey) &&
    window.supabase && typeof window.supabase.createClient === 'function');
}
function cloudActive() {
  return !!(Cloud.client && Cloud.user && isAuthenticated && !session.plain && session.key);
}
function cloudVaultMeta() {
  return { rev: Cloud.rev, dirty: true, base: Cloud.baseEnc || null, forceUpload: Cloud.forceUpload || undefined };
}
function cloudErrMsg(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Primero confirma tu correo (revisa tu bandeja y spam).';
  if (/already registered|already been registered/i.test(m)) return 'Ese correo ya tiene cuenta: usa "Iniciar sesión".';
  if (/at least 6|Password should be/i.test(m)) return 'La contraseña de la nube debe tener al menos 6 caracteres.';
  if (/vaults|relation .* does not exist|schema cache/i.test(m)) return 'Falta crear la tabla en Supabase: ejecuta el archivo supabase-setup.sql.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con Supabase.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento.';
  return m || 'Error desconocido';
}

// ---------- Estado visual ----------
function cloudStatusText() {
  if (!Cloud.user) return 'Sin sesión';
  if (Cloud.status === 'syncing') return 'Sincronizando…';
  if (Cloud.status === 'offline') return 'Sin internet · se sincroniza al reconectar';
  if (Cloud.status === 'error') return '⚠️ ' + (Cloud.lastError || 'Error de sincronización');
  if (Cloud.lastSync) return 'Sincronizado · ' + new Date(Cloud.lastSync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return 'Conectado';
}
function cloudBadgeIcon() {
  return { syncing: '🔄', error: '⚠️', offline: '📴' }[Cloud.status] || '☁️';
}
function cloudSetStatus(st, err) {
  Cloud.status = st;
  if (err !== undefined) Cloud.lastError = err;
  const b = document.getElementById('cloudBadge');
  if (b) { b.textContent = cloudBadgeIcon(); b.title = 'Nube: ' + cloudStatusText(); }
  const s = document.getElementById('cloudStatusText');
  if (s) s.textContent = cloudStatusText();
}
function cloudHeaderBadge() {
  if (!cloudConfigured() || !Cloud.user) return '';
  return `<button class="btn-icon" id="cloudBadge" onclick="cloudSync()" title="Nube: ${esc(cloudStatusText())}" aria-label="Sincronizar">${cloudBadgeIcon()}</button>`;
}
function cloudLockHtml() {
  if (!cloudConfigured()) return '';
  if (Cloud.user) {
    return `<div style="margin-top:14px; font-size:12px; color:var(--text-muted); font-weight:700;">
      ☁️ Sincronizado con <b>${esc(Cloud.user.email)}</b> ·
      <button type="button" onclick="cloudSignOut()" style="background:none; border:none; color:var(--usd-color); font-weight:800; cursor:pointer; text-decoration:underline;">cerrar sesión</button>
    </div>`;
  }
  return `<div style="margin-top:14px;">
    <button type="button" class="btn-secondary" onclick="openCloudModal()">☁️ Sincronizar con mis otros dispositivos</button>
  </div>`;
}
function cloudSettingsHtml() {
  const head = `<div class="card-title-row"><div class="card-title">☁️ Sincronización entre Dispositivos</div></div>`;
  if (!cloudConfigured()) {
    return `<div class="card">${head}
      <div class="alert-box info"><span>ℹ️</span><span>La sincronización aún no está configurada. Crea tu proyecto en Supabase, ejecuta <b>supabase-setup.sql</b> y escribe tu URL y clave en <b>cloud-config.js</b>. ${window.supabase ? '' : '<br>(Tampoco se pudo cargar la librería de Supabase: revisa tu internet.)'}</span></div>
    </div>`;
  }
  if (session.plain) {
    return `<div class="card">${head}<div class="alert-box warn"><span>⚠️</span><span>Para sincronizar se necesita el cifrado activo (abre la app desde https).</span></div></div>`;
  }
  if (!Cloud.user) {
    return `<div class="card">${head}
      <p style="font-size:13.5px; color:var(--text-muted); margin-bottom:12px;">Inicia sesión con la misma cuenta en tu celular y tu computadora: lo que cambies en uno aparecerá en el otro automáticamente. Tus datos viajan <b>cifrados</b>; Supabase no puede leerlos.</p>
      <button class="btn-submit" onclick="openCloudModal()" style="margin-top:0;">☁️ Iniciar sesión / Crear cuenta</button>
    </div>`;
  }
  return `<div class="card">${head}
    <div class="plan-row">
      <div class="plan-row-top">
        <div>
          <div class="plan-row-sub">Cuenta</div>
          <div class="plan-row-title">${esc(Cloud.user.email)}</div>
        </div>
        <span class="tag good">Cifrado de extremo a extremo</span>
      </div>
    </div>
    <div class="plan-row">
      <div class="plan-row-sub">Estado</div>
      <div class="plan-row-title" id="cloudStatusText">${esc(cloudStatusText())}</div>
    </div>
    <div class="stock-actions">
      <button class="mini-btn" onclick="cloudSync()">🔄 Sincronizar ahora</button>
      <button class="mini-btn danger" onclick="cloudSignOut()">Cerrar sesión de la nube</button>
    </div>
    <span class="form-hint" style="margin-top:10px;">Usa la <b>misma contraseña de la app</b> en todos tus dispositivos. Si la cambias en uno, los demás te la pedirán de nuevo.</span>
  </div>`;
}

function cloudRefreshUi() {
  if (!isAuthenticated) return;
  const y = window.scrollY;
  const active = document.activeElement;
  // No interrumpir si el usuario está escribiendo dentro de la página
  if (active && active.closest && active.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) {
    Cloud.needsRender = true;
    active.addEventListener('blur', () => { if (Cloud.needsRender) { Cloud.needsRender = false; render(); } }, { once: true });
    return;
  }
  render();
  window.scrollTo(0, y);
}

// ---------- Acceso a la tabla ----------
async function cloudFetchRow(full = true) {
  const { data, error } = await Cloud.client
    .from('vaults')
    .select(full ? 'data, rev' : 'rev')
    .eq('user_id', Cloud.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
function writeLocalVaultClean(data, rev) {
  const obj = Object.assign({}, data, { rev: num(rev), dirty: false });
  saveChain = saveChain.then(() => localStorage.setItem(VAULT_KEY, JSON.stringify(obj)));
  return saveChain;
}

// ---------- Fusión de cambios (3 vías: base / este dispositivo / nube) ----------
const MERGE_ARRAYS = ['cards', 'cashTx', 'tx', 'transfers', 'stocks', 'dividends', 'invoices', 'recurring', 'goals'];
const MERGE_FIELDS = ['cashBase', 'invested', 'gbmCashBase', 'fx', 'fxd', 'settings', 'budgets'];

function mergeById(B, L, R) {
  const base = new Map((B || []).map(x => [x.id, JSON.stringify(x)]));
  const loc = new Map((L || []).map(x => [x.id, x]));
  const rem = new Set((R || []).map(x => x.id));
  const out = [];
  (R || []).forEach(x => {
    if (base.has(x.id) && !loc.has(x.id)) return;               // borrado en este dispositivo
    const lx = loc.get(x.id);
    const remoteUnchanged = base.get(x.id) === JSON.stringify(x);
    if (lx && base.has(x.id) && JSON.stringify(lx) !== base.get(x.id) && remoteUnchanged) out.push(lx); // editado aquí
    else out.push(x);
  });
  (L || []).forEach(x => { if (!rem.has(x.id) && !base.has(x.id)) out.push(x); }); // nuevo en este dispositivo
  return out;
}
function mergeStates(base, local, remote) {
  const out = JSON.parse(JSON.stringify(remote));
  MERGE_ARRAYS.forEach(k => { out[k] = mergeById(base[k], local[k], remote[k]); });
  MERGE_FIELDS.forEach(k => {
    if (JSON.stringify(local[k]) !== JSON.stringify(base[k])) out[k] = JSON.parse(JSON.stringify(local[k] === undefined ? null : local[k]));
  });
  const snaps = {};
  (local.snaps || []).forEach(s => { snaps[s.d] = s; });
  (remote.snaps || []).forEach(s => { snaps[s.d] = s; });
  out.snaps = Object.values(snaps).sort((a, b) => a.d.localeCompare(b.d));
  return out;
}

// ---------- Inicio ----------
async function cloudInit() {
  if (!cloudConfigured()) return;
  try {
    Cloud.client = window.supabase.createClient(window.BC_CLOUD.url, window.BC_CLOUD.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bc_cloud_auth' }
    });
    const { data } = await Cloud.client.auth.getSession();
    Cloud.user = data && data.session ? data.session.user : null;
    Cloud.client.auth.onAuthStateChange((_ev, s) => { Cloud.user = s ? s.user : null; });
    if (Cloud.user) {
      const changed = await cloudBeforeUnlock();
      const inp = $('lockPassInput');
      if (changed && !isAuthenticated && (!inp || !inp.value)) render();
    }
    if (!isAuthenticated) {
      const slot = $('cloudLockSlot');
      if (slot) slot.innerHTML = cloudLockHtml();
    }
  } catch (e) {
    console.warn('Cloud init:', e);
  }
}

// Antes de desbloquear: traer la versión más reciente de la nube
async function cloudBeforeUnlock() {
  if (!Cloud.client || !Cloud.user || navigator.onLine === false) return false;
  try {
    const row = await cloudFetchRow(true);
    if (!row || !row.data || !row.data.ct) return false;
    const local = readVault();
    const remoteRev = num(row.rev);
    const forcing = localStorage.getItem(FORCE_UPLOAD_KEY) !== null || (local && local.forceUpload);
    let useRemote;
    if (!local) useRemote = !forcing;
    else if (forcing) useRemote = false;
    else if (!local.dirty) useRemote = remoteRev !== num(local.rev) || local.salt !== row.data.salt;
    else useRemote = local.salt !== row.data.salt && remoteRev > num(local.rev);
    if (useRemote) {
      localStorage.setItem(VAULT_KEY, JSON.stringify(Object.assign({}, row.data, { rev: remoteRev, dirty: false })));
      return true;
    }
  } catch (e) {
    cloudSetStatus('error', cloudErrMsg(e));
  }
  return false;
}

// Después de desbloquear: preparar la base de comparación y escuchar cambios
function cloudAfterUnlock(unlockedJson) {
  if (!cloudActive()) return;
  const v = readVault() || {};
  Cloud.rev = num(v.rev);
  Cloud.forceUpload = !!v.forceUpload;
  Cloud.baseJson = null;
  Cloud.baseEnc = null;
  const flag = localStorage.getItem(FORCE_UPLOAD_KEY);
  if (flag !== null) {
    Cloud.forceUpload = true;
    Cloud.rev = num(flag);
    localStorage.removeItem(FORCE_UPLOAD_KEY);
  }
  Cloud.ready = (async () => {
    if (Cloud.forceUpload) return;
    if (!v.dirty && unlockedJson && Cloud.rev > 0) {
      Cloud.baseJson = unlockedJson;
      Cloud.baseEnc = { iv: v.iv, ct: v.ct };
    } else if (v.dirty && v.base) {
      try {
        const bj = await decryptText(session.key, v.base.iv, v.base.ct);
        Cloud.baseJson = JSON.stringify(normalizeState(JSON.parse(bj)));
        Cloud.baseEnc = v.base;
      } catch (e) { /* base ilegible: se usará la versión de la nube en caso de conflicto */ }
    }
  })();
  cloudSubscribe();
  cloudSync();
}

function cloudOnLock() {
  cloudUnsubscribe();
  clearTimeout(Cloud.timer);
  Cloud.rev = 0;
  Cloud.baseJson = null;
  Cloud.baseEnc = null;
  Cloud.forceUpload = false;
  Cloud.keyChanged = false;
  Cloud.altKeys = {};
  Cloud.pending = false;
}

function cloudRememberKey() {
  if (session.key && session.salt) Cloud.altKeys[bufToB64(session.salt)] = session.key;
  Cloud.baseEnc = null;
  Cloud.keyChanged = true; // hay que volver a subir aunque los datos no hayan cambiado
}

function cloudSchedule() {
  if (!cloudActive()) return;
  clearTimeout(Cloud.timer);
  Cloud.timer = setTimeout(cloudSync, 1000);
}

// ---------- Realtime ----------
function cloudSubscribe() {
  cloudUnsubscribe();
  if (!cloudActive()) return;
  Cloud.channel = Cloud.client
    .channel('vault-' + Cloud.user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vaults', filter: 'user_id=eq.' + Cloud.user.id }, payload => {
      const rev = payload && payload.new ? num(payload.new.rev) : 0;
      if (rev && rev <= Cloud.rev) return; // es nuestro propio cambio
      cloudSync();
    })
    .subscribe();
}
function cloudUnsubscribe() {
  if (Cloud.channel && Cloud.client) Cloud.client.removeChannel(Cloud.channel);
  Cloud.channel = null;
}

// ---------- Subir / bajar ----------
async function cloudPushOnce() {
  const json = JSON.stringify(S);
  const key = session.key, salt = session.salt, iter = session.iter, hint = session.hint;
  const { iv, ct } = await encryptText(key, json);
  const data = { v: 2, enc: true, salt: bufToB64(salt), iter, iv, ct, hint };
  let newRev;
  if (Cloud.rev === 0) {
    const { error } = await Cloud.client.from('vaults').insert({ user_id: Cloud.user.id, data, rev: 1 });
    if (error) {
      if (error.code === '23505') return 'conflict';
      throw error;
    }
    newRev = 1;
  } else {
    const { data: rows, error } = await Cloud.client
      .from('vaults')
      .update({ data, rev: Cloud.rev + 1, updated_at: new Date().toISOString() })
      .eq('user_id', Cloud.user.id)
      .eq('rev', Cloud.rev)
      .select('rev');
    if (error) throw error;
    if (!rows || !rows.length) {
      const head = await cloudFetchRow(false);
      if (!head) { Cloud.rev = 0; return 'retry'; }
      return 'conflict';
    }
    newRev = num(rows[0].rev);
  }
  if (!cloudActive()) return 'ok';
  Cloud.rev = newRev;
  Cloud.baseJson = json;
  Cloud.baseEnc = { iv, ct };
  Cloud.forceUpload = false;
  if (session.key === key) Cloud.keyChanged = false;
  if (JSON.stringify(S) === json && session.key === key) {
    writeLocalVaultClean(data, newRev);
    return 'ok';
  }
  persist(); // hubo cambios mientras se subía
  return 'retry';
}

async function cloudMergeRemote() {
  const head = await cloudFetchRow(false);
  if (!head) { Cloud.rev = 0; return 'gone'; }
  if (num(head.rev) === Cloud.rev) return 'same';
  const row = await cloudFetchRow(true);
  if (!cloudActive()) return 'locked';
  if (!row) { Cloud.rev = 0; return 'gone'; }

  const mySalt = bufToB64(session.salt);
  const key = row.data.salt === mySalt ? session.key : Cloud.altKeys[row.data.salt];
  let remoteJson = null;
  if (key) { try { remoteJson = await decryptText(key, row.data.iv, row.data.ct); } catch (e) { remoteJson = null; } }
  if (!cloudActive()) return 'locked';

  if (remoteJson === null) {
    // La contraseña se cambió en otro dispositivo
    await writeLocalVaultClean(row.data, row.rev);
    await lockSession();
    toast('🔐 Tu contraseña se cambió en otro dispositivo. Ingresa la nueva.', 6000);
    return 'locked';
  }

  const remote = normalizeState(JSON.parse(remoteJson));
  const remoteStr = JSON.stringify(remote);
  const localChanged = Cloud.baseJson !== null && JSON.stringify(S) !== Cloud.baseJson;
  S = localChanged ? normalizeState(mergeStates(JSON.parse(Cloud.baseJson), S, remote)) : remote;
  Cloud.rev = num(row.rev);
  Cloud.baseJson = remoteStr;
  Cloud.baseEnc = key === session.key ? { iv: row.data.iv, ct: row.data.ct } : null;

  if (JSON.stringify(S) === remoteStr && key === session.key) writeLocalVaultClean(row.data, row.rev);
  else persist();

  cloudRefreshUi();
  toast(localChanged ? '☁️ Se combinaron tus cambios con los de otro dispositivo' : '☁️ Actualizado desde otro dispositivo');
  return 'merged';
}

async function cloudSync() {
  if (!cloudActive()) return;
  if (Cloud.busy) { Cloud.pending = true; return; }
  if (navigator.onLine === false) { cloudSetStatus('offline'); return; }
  Cloud.busy = true;
  clearTimeout(Cloud.timer);
  cloudSetStatus('syncing');
  try {
    await Cloud.ready;
    for (let i = 0; i < 6 && cloudActive(); i++) {
      const dirty = Cloud.forceUpload || Cloud.keyChanged || Cloud.rev === 0 || Cloud.baseJson === null || JSON.stringify(S) !== Cloud.baseJson;
      if (!dirty) {
        const r = await cloudMergeRemote();
        if (r === 'locked') return;
        if (r === 'gone') continue;
        if (JSON.stringify(S) === Cloud.baseJson) break;
        continue;
      }
      const r = await cloudPushOnce();
      if (r === 'ok') break;
      if (r === 'conflict') {
        if (Cloud.forceUpload) {
          const head = await cloudFetchRow(false);
          Cloud.rev = head ? num(head.rev) : 0;
          continue;
        }
        const m = await cloudMergeRemote();
        if (m === 'locked') return;
      }
    }
    Cloud.lastSync = Date.now();
    cloudSetStatus('idle', '');
  } catch (e) {
    console.warn('Cloud sync:', e);
    cloudSetStatus(navigator.onLine === false ? 'offline' : 'error', cloudErrMsg(e));
  } finally {
    Cloud.busy = false;
    if (Cloud.pending) { Cloud.pending = false; setTimeout(cloudSync, 300); }
  }
}

// ---------- Inicio de sesión en la nube ----------
function openCloudModal() {
  if (!cloudConfigured()) { toast('La sincronización no está configurada (cloud-config.js).'); return; }
  $('cloudEmail').value = (Cloud.user && Cloud.user.email) || '';
  $('cloudPass').value = '';
  $('cloudMsg').textContent = '';
  $('cloudMsg').style.color = '';
  openModal('cloudModal', 'cloudEmail');
}

async function handleCloudAuth(mode) {
  const email = $('cloudEmail').value.trim();
  const pass = $('cloudPass').value;
  const msg = $('cloudMsg');
  msg.style.color = '';
  if (!email || !pass) { msg.textContent = 'Escribe tu correo y contraseña.'; return; }
  if (pass.length < 6) { msg.textContent = 'La contraseña de la nube debe tener al menos 6 caracteres.'; return; }
  const btns = [$('cloudLoginBtn'), $('cloudSignupBtn')];
  btns.forEach(b => { b.disabled = true; });
  msg.textContent = '⏳ Conectando…';
  try {
    const res = mode === 'signup'
      ? await Cloud.client.auth.signUp({ email, password: pass })
      : await Cloud.client.auth.signInWithPassword({ email, password: pass });
    if (res.error) { msg.textContent = '❌ ' + cloudErrMsg(res.error); return; }
    if (mode === 'signup' && !res.data.session) {
      msg.style.color = 'var(--income)';
      msg.textContent = '📧 Te enviamos un correo para confirmar tu cuenta. Confírmalo y después toca "Iniciar sesión".';
      return;
    }
    Cloud.user = res.data.user || (res.data.session && res.data.session.user);
    closeModal('cloudModal');
    await cloudAfterLogin();
  } catch (e) {
    msg.textContent = '❌ ' + cloudErrMsg(e);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

async function cloudAfterLogin() {
  let row = null;
  try { row = await cloudFetchRow(true); }
  catch (e) { toast('⚠️ ' + cloudErrMsg(e), 6000); cloudSetStatus('error', cloudErrMsg(e)); render(); return; }

  const local = readVault();
  const legacy = readLegacy();
  const hasLocal = !!local || !!(legacy && legacy.pass);

  // Nube vacía → subir lo de este dispositivo
  if (!row || !row.data) {
    if (isAuthenticated) {
      Cloud.rev = 0;
      Cloud.forceUpload = true;
      Cloud.baseJson = null;
      cloudSubscribe();
      render();
      await cloudSync();
      toast('☁️ Tus datos ya están en la nube. Inicia sesión en tu otro dispositivo.', 5000);
    } else {
      render();
      toast('☁️ Sesión iniciada. Desbloquea para subir tus datos.');
    }
    return;
  }

  // Dispositivo nuevo → descargar
  if (!hasLocal) {
    localStorage.setItem(VAULT_KEY, JSON.stringify(Object.assign({}, row.data, { rev: num(row.rev), dirty: false })));
    render();
    toast('☁️ Datos descargados. Ingresa la contraseña de tu app.', 5000);
    return;
  }

  // Hay datos en ambos lados
  const useCloud = confirm(
    'Ya tienes datos guardados en la nube.\n\n' +
    'ACEPTAR → usar los datos de la NUBE en este dispositivo (los de este dispositivo se reemplazan).\n\n' +
    'CANCELAR → conservar los datos de ESTE dispositivo y reemplazar los de la nube.'
  );
  if (useCloud) {
    await saveChain;
    localStorage.setItem(VAULT_KEY, JSON.stringify(Object.assign({}, row.data, { rev: num(row.rev), dirty: false })));
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(FORCE_UPLOAD_KEY);
    if (isAuthenticated) {
      isAuthenticated = false; // evita que el estado actual sobrescriba lo descargado
      S = defaultState();
      session = emptySession();
      cloudOnLock();
      closeAllModals();
    }
    render();
    toast('☁️ Listo. Ingresa la contraseña de la app con la que creaste esos datos.', 6000);
  } else if (isAuthenticated) {
    Cloud.rev = num(row.rev);
    Cloud.forceUpload = true;
    cloudSubscribe();
    render();
    await cloudSync();
    toast('☁️ Los datos de este dispositivo reemplazaron a los de la nube.', 5000);
  } else {
    localStorage.setItem(FORCE_UPLOAD_KEY, String(num(row.rev)));
    render();
    toast('☁️ Desbloquea para subir los datos de este dispositivo.', 5000);
  }
}

async function cloudSignOut() {
  if (!confirm('¿Cerrar la sesión de la nube en este dispositivo? Tus datos se quedan guardados aquí y en la nube, pero dejarán de sincronizarse.')) return;
  if (cloudActive()) { await cloudSync(); }
  cloudOnLock();
  try { await Cloud.client.auth.signOut(); } catch (e) {}
  Cloud.user = null;
  cloudSetStatus('off', '');
  render();
  toast('☁️ Sesión de la nube cerrada');
}

// Al borrar todos los datos
async function cloudBeforeReset() {
  if (!Cloud.client || !Cloud.user) return;
  const alsoCloud = confirm('¿Borrar también tus datos de la NUBE?\n\nACEPTAR → se borran en todos tus dispositivos.\nCANCELAR → solo se borra este dispositivo (y se cierra aquí la sesión de la nube).');
  cloudOnLock();
  if (alsoCloud) {
    try {
      const { error } = await Cloud.client.from('vaults').delete().eq('user_id', Cloud.user.id);
      if (error) throw error;
    } catch (e) { toast('⚠️ No se pudo borrar de la nube: ' + cloudErrMsg(e), 6000); }
  } else {
    try { await Cloud.client.auth.signOut(); } catch (e) {}
    Cloud.user = null;
  }
  localStorage.removeItem(FORCE_UPLOAD_KEY);
}

// ---------- Eventos ----------
window.addEventListener('online', () => cloudSync());
window.addEventListener('offline', () => { if (cloudActive()) cloudSetStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudSync(); });
setInterval(() => { if (cloudActive() && !document.hidden) cloudSync(); }, 60000);

cloudInit();
