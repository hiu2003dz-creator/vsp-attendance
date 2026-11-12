(function () {
  'use strict';
  const config = window.VSP_FIREBASE_CONFIG;
  const preview = new URLSearchParams(window.location.search).get('firebase') === 'preview';
  const enabled = Boolean(config && (config.enabled || preview));
  const staging = enabled && config.migrationPhase === 'staging';
  const legacySite = window.location.hostname === 'hiu2003dz-creator.github.io'
    && /^\/vsp-attendance(?:\/|$)/.test(window.location.pathname || '');
  const key = 'VSP_FIREBASE_SESSION_V1_' + (config?.projectId || 'unconfigured');
  let session = null;
  let refreshPromise = null;
  let loginNoticeShown = false;
  function legacyValue(name) {
    try {
      const saved = localStorage.getItem(name);
      if (saved) return saved;
      const cookieName = { CC_USER_V11: 'CC_USER_DATA', MY_SAVED_U: 'CC_SAVED_U', MY_SAVED_P: 'CC_SAVED_P' }[name];
      const part = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='));
      return part ? decodeURIComponent(part.slice(cookieName.length + 1)) : '';
    } catch { return ''; }
  }
  function legacyUsername() {
    if (!legacySite) return '';
    try {
      const active = JSON.parse(legacyValue('CC_USER_V11') || 'null')?.id;
      if (active) return active;
    } catch {}
    return legacyValue('MY_SAVED_U');
  }
  async function resumeLegacySession() {
    if (!enabled || !legacySite || !navigator.onLine) return null;
    const username = legacyUsername();
    const rememberedUsername = legacyValue('MY_SAVED_U');
    if (rememberedUsername && String(rememberedUsername).trim().toUpperCase() !== String(username).trim().toUpperCase()) return null;
    const password = legacyValue('MY_SAVED_P');
    if (!username || !password) return null;
    const result = await login(username, password, true);
    return result.success ? result : null;
  }
  function clearLegacyAuth() {
    if (!legacySite) return;
    // Clear only the obsolete login after the Firebase profile is saved. Keep
    // original IndexedDB, Cache Storage, schedules and attendance evidence.
    for (const name of ['CC_USER_V11', 'MY_SAVED_U', 'MY_SAVED_P']) localStorage.removeItem(name);
    for (const name of ['CC_USER_DATA', 'CC_SAVED_U', 'CC_SAVED_P']) document.cookie = name + '=;Max-Age=0;path=/';
  }

  function readSession() {
    if (session) return session;
    try { session = JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || 'null'); }
    catch { session = null; }
    return session;
  }
  function saveSession(next) {
    session = next;
    const target = next.remember ? localStorage : sessionStorage;
    const other = next.remember ? sessionStorage : localStorage;
    other.removeItem(key);
    target.setItem(key, JSON.stringify(next));
  }
  function signOut() {
    session = null;
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
  function authError(message) {
    const error = new Error(message || 'Vui lòng đăng nhập lại để đồng bộ. Dữ liệu chờ vẫn được giữ.');
    error.code = 'AUTH_REQUIRED';
    if (!loginNoticeShown && typeof window.showToast === 'function') {
      loginNoticeShown = true;
      window.showToast(error.message);
    }
    return error;
  }
  async function jsonRequest(url, data, headers, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try {
      const isTokenRequest = url.startsWith('https://securetoken.googleapis.com/');
      const response = await fetch(url, { method: 'POST', headers: {
        'Content-Type': isTokenRequest ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
        body: isTokenRequest ? new URLSearchParams(data).toString() : JSON.stringify(data), cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      return { response, body };
    } finally { clearTimeout(timer); }
  }
  function emailFor(code) {
    const bytes = new TextEncoder().encode(String(code).trim().toUpperCase());
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `staff.${hex}@attendance.${config.projectId}.invalid`;
  }
  async function token() {
    const current = readSession();
    if (!current) throw authError();
    if (current.expiresAt > Date.now() + 60000) return current.idToken;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const result = await jsonRequest(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`,
          { grant_type: 'refresh_token', refresh_token: current.refreshToken });
        if (!result.response.ok) throw authError();
        if (session !== current) throw authError('Tài khoản đã thay đổi. Vui lòng thử lại.');
        saveSession({ ...current, idToken: result.body.id_token, refreshToken: result.body.refresh_token,
          expiresAt: Date.now() + Number(result.body.expires_in) * 1000 });
        return session.idToken;
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  async function call(action, payload) {
    if (action === 'loginUser') return login(payload.u, payload.p, Boolean(document.getElementById('chk-save')?.checked));
    if (!navigator.onLine) throw new Error('Offline');
    const idToken = await token();
    const { response, body } = await jsonRequest(config.apiUrl, { ...payload, action }, { Authorization: `Bearer ${idToken}` }, 45000);
    if (response.status === 401 || response.status === 403) throw authError(body.msg);
    if (response.status >= 500) {
      const error = new Error(body.msg || 'ServerBusy');
      error.code = body.code || 'RETRY_LATER';
      throw error; // Keep offline evidence for transient/staging errors.
    }
    return body;
  }
  async function login(code, password, remember) {
    const { response, body } = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
      { email: emailFor(code), password: String(password).trim(), returnSecureToken: true });
    if (!response.ok) {
      if (response.status >= 500 || body.error?.message === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw new Error('Không đăng nhập được lúc này. Vui lòng thử lại sau.');
      return { success: false, msg: 'Sai mã nhân viên hoặc mật khẩu.' };
    }
    saveSession({ uid: body.localId, idToken: body.idToken, refreshToken: body.refreshToken,
      expiresAt: Date.now() + Number(body.expiresIn) * 1000, remember: Boolean(remember) });
    loginNoticeShown = false;
    try {
      const profile = await call('getUserProfile', {});
      if (!profile?.id) throw new Error('Không tải được hồ sơ chấm công.');
      return { success: true, ...profile, avatar: profile.img };
    } catch (error) { signOut(); throw error; }
  }
  window.VSPFirebase = Object.freeze({ enabled, preview, staging, legacySite, legacyUsername, resumeLegacySession, clearLegacyAuth,
    call, signOut, hasSession: () => Boolean(readSession()), emailFor });
  if (preview || staging) document.body.classList.add('firebase-preview');
})();
