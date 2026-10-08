/* SmartBudget GPS PWA 2.5.3: private Google OAuth transport, no financial cache. */
(() => {
  'use strict';
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/script.external_request'
  ];
  const READS = new Set(['login', 'dashboard', 'configuration', 'gpsConfiguration',
    'operationContext', 'incomeSuggestion', 'requestStatus', 'export']);
  const ACCOUNT_KEY = 'budgetsmart-google-account';
  const validAccount = value => typeof value === 'string' && value.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  function preferredAccount() {
    let account = '';
    try {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      if (fragment.has('account')) {
        const supplied = fragment.get('account').trim();
        if (validAccount(supplied)) {
          account = supplied;
          // Remember only a non-secret account preference, never an access token.
          try { window.localStorage.setItem(ACCOUNT_KEY, account); } catch {}
        }
        fragment.delete('account');
        const remaining = fragment.toString();
        window.history.replaceState(null, '', window.location.pathname + window.location.search +
          (remaining ? '#' + remaining : ''));
      }
    } catch {}
    if (!account) {
      try {
        const stored = window.localStorage.getItem(ACCOUNT_KEY);
        if (validAccount(stored)) account = stored;
      } catch {}
    }
    return account;
  }
  const loginHint = preferredAccount();
  const gate = document.getElementById('googleLogin');
  const button = document.getElementById('googleConnect');
  const status = document.getElementById('googleStatus');
  const error = document.getElementById('googleError');
  let config, prepared = false, preparing, auth, attempt = 0, generation = 0;
  let connecting = false, expiryTimer, popupTimer, installPrompt;
  let firstConnectionResolve;
  const firstConnection = new Promise(resolve => { firstConnectionResolve = resolve; });

  function showGate(message = '', isError = false) {
    gate.hidden = false;
    status.textContent = isError ? '' : message;
    error.textContent = isError ? message : '';
  }
  function usable() { return auth && auth.expiresAt - Date.now() > 360000; }
  function forget() {
    generation++;
    auth = null;
    clearTimeout(expiryTimer);
  }
  function releaseAttempt() {
    connecting = false;
    clearTimeout(popupTimer);
    button.disabled = false;
    button.textContent = prepared ? 'Continuer avec Google' : 'Réessayer';
  }
  function uncertainty(request, message) {
    return !request || READS.has(request.action) ? message : message +
      ' La modification peut déjà être enregistrée. Vérifiez le journal ou les réglages avant de renvoyer.';
  }
  function permissionError(code, body) {
    const reason = body?.error?.details?.find(item => item.reason)?.reason;
    if (code === 401) return 'Session Google expirée ou révoquée. Reconnectez-vous.';
    if (code === 403 && reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
      return 'Une permission Google nécessaire manque. Reconnectez-vous et accordez les permissions demandées.';
    if (code === 403 && reason === 'SERVICE_DISABLED')
      return 'L’API Apps Script doit être activée dans le projet Google Cloud lié.';
    if (code === 403) return 'Accès Google refusé (403). Sélectionnez le compte propriétaire du budget. Si le problème persiste, vérifiez le projet Google Cloud lié au script.';
    if (code === 404) return 'Le déploiement API est introuvable. Vérifiez son identifiant dans Apps Script.';
    if (code === 429) return 'La limite temporaire de requêtes Google est atteinte. Patientez avant de réessayer.';
    return 'Le service Google est momentanément indisponible (' + code + '). Réessayez plus tard.';
  }

  async function execute(request, credentials = auth) {
    if (navigator.onLine === false) throw new Error('Vous êtes hors connexion. Aucune opération n’a été transmise.');
    if (!credentials || credentials.expiresAt - Date.now() <= 360000) {
      showGate('Votre connexion Google doit être renouvelée.');
      throw new Error('Reconnectez-vous à Google pour continuer.');
    }
    const epoch = generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    let response, body;
    try {
      response = await fetch(config.apiUrl, {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credentials.token },
        body: JSON.stringify({ function: 'api_request', parameters: [request], devMode: false }),
        signal: controller.signal
      });
      body = await response.json();
    } catch (failure) {
      const message = failure?.name === 'AbortError' ? 'Google met trop de temps à répondre.' : 'La réponse Google n’a pas pu être reçue.';
      throw new Error(uncertainty(request, message));
    } finally { clearTimeout(timeout); }
    if (epoch !== generation) throw new Error(uncertainty(request, 'La session Google a changé pendant la requête.'));
    if (!response.ok) {
      const message = permissionError(response.status, body);
      if (response.status === 401 || response.status === 403) {
        forget();
        showGate(message, true);
      }
      throw new Error(response.status >= 500 || response.status === 408 ? uncertainty(request, message) : message);
    }
    if (body?.error) {
      if (body.error.code === 16 || body.error.code === 7) {
        const message = permissionError(body.error.code === 16 ? 401 : 403, body);
        forget(); showGate(message, true); throw new Error(message);
      }
      const detail = body.error.details?.[0]?.errorMessage;
      throw new Error(uncertainty(request, detail ? String(detail).slice(0, 400) : 'Le script n’a pas pu terminer cette requête.'));
    }
    const result = body?.response?.result;
    if (!body?.done || !result || typeof result !== 'object' || typeof result.ok !== 'boolean')
      throw new Error(uncertainty(request, 'Réponse du déploiement API invalide.'));
    return result;
  }

  async function acceptToken(response, sequence) {
    if (sequence !== attempt || !connecting) return;
    if (response.error) {
      showGate(response.error === 'access_denied' ? 'Connexion annulée ou permissions refusées. Vous pouvez réessayer.' : 'La connexion Google a échoué (' + response.error + ').', true);
      releaseAttempt(); return;
    }
    if (!response.access_token || response.token_type?.toLowerCase() !== 'bearer' ||
        !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 360) {
      showGate('Google n’a pas fourni une session utilisable. Réessayez.', true);
      releaseAttempt(); return;
    }
    const granted = new Set(String(response.scope || '').split(/\s+/));
    if (!SCOPES.every(scope => granted.has(scope))) {
      showGate('Les permissions nécessaires n’ont pas toutes été accordées. Réessayez en autorisant les trois permissions demandées.', true);
      releaseAttempt(); return;
    }
    clearTimeout(popupTimer);
    const candidate = { token: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 };
    status.textContent = 'Vérification de l’accès privé…';
    try {
      // A null request exercises the private API boundary; api_request returns
      // before authentication, spreadsheet access, PIN checks or any write.
      const probe = await execute(null, candidate);
      if (sequence !== attempt || !connecting) return;
      if (probe.ok !== false || probe.error !== 'Requête invalide.')
        throw new Error('Le déploiement ne correspond pas au moteur BudgetSmart attendu.');
      forget(); auth = candidate;
      expiryTimer = setTimeout(() => showGate('Votre connexion Google doit être renouvelée.'),
        Math.max(0, candidate.expiresAt - Date.now() - 360000));
      error.textContent = ''; status.textContent = ''; gate.hidden = true;
      firstConnectionResolve();
      window.dispatchEvent(new Event('budget-google-connected'));
    } catch (failure) {
      if (sequence === attempt) { forget(); showGate(failure.message, true); }
    } finally { if (sequence === attempt) releaseAttempt(); }
  }

  function authorize() {
    if (connecting) return;
    if (navigator.onLine === false) { showGate('Une connexion Internet est nécessaire pour ouvrir votre budget.', true); return; }
    if (!prepared) { prepare(); return; }
    connecting = true;
    const sequence = ++attempt;
    button.disabled = true; button.textContent = 'Connexion Google…';
    showGate(loginHint ? 'Connexion avec votre compte Google habituel…' :
      'Confirmez la connexion à votre compte Google dans la fenêtre Google.');
    popupTimer = setTimeout(() => {
      if (sequence !== attempt) return;
      attempt++; releaseAttempt();
      showGate('La connexion Google n’a pas abouti. Vérifiez la fenêtre Google, puis réessayez.', true);
    }, 120000);
    try {
      // Called synchronously from the click, preserving browser popup permission.
      const client = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId, scope: SCOPES.join(' '), include_granted_scopes: false,
        prompt: '',
        ...(loginHint ? { login_hint: loginHint } : {}),
        callback: response => acceptToken(response, sequence),
        error_callback: failure => {
          if (sequence !== attempt || !connecting) return;
          const message = failure.type === 'popup_failed_to_open' ?
            'Chrome a bloqué la fenêtre Google. Autorisez les fenêtres contextuelles pour ce site, puis réessayez.' :
            failure.type === 'popup_closed' ? 'La fenêtre Google a été fermée. Vous pouvez réessayer.' :
            'La fenêtre de connexion Google n’a pas pu aboutir. Réessayez.';
          showGate(message, true); releaseAttempt();
        }
      });
      client.requestAccessToken();
    } catch (failure) { showGate('La connexion Google n’a pas pu démarrer. Rechargez la page puis réessayez.', true); releaseAttempt(); }
  }

  function loadIdentity() {
    if (window.google?.accounts?.oauth2?.initTokenClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = failure => {
        if (settled) return; settled = true; clearTimeout(timeout);
        script.onload = script.onerror = null;
        if (failure) { script.remove(); reject(failure); }
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('Le service de connexion Google ne répond pas. Réessayez.')), 20000);
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = () => finish(window.google?.accounts?.oauth2?.initTokenClient ? null : new Error('Le service de connexion Google n’a pas pu être chargé.'));
      script.onerror = () => finish(new Error('Le service de connexion Google est inaccessible. Vérifiez votre connexion.'));
      document.head.appendChild(script);
    });
  }
  async function readConfiguration() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('./config.json', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('Configuration indisponible.');
      const value = await response.json();
      if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value.clientId || '') ||
          !/^https:\/\/script\.googleapis\.com\/v1\/scripts\/[A-Za-z0-9_-]+:run$/.test(value.apiUrl || ''))
        throw new Error('La configuration de connexion BudgetSmart est invalide.');
      return value;
    } finally { clearTimeout(timeout); }
  }
  function prepare() {
    if (preparing) return preparing;
    button.disabled = true; button.textContent = 'Préparation…';
    showGate('Préparation de la connexion sécurisée…');
    preparing = Promise.all([readConfiguration(), loadIdentity()]).then(([value]) => {
      config = value; prepared = true; releaseAttempt();
      showGate(loginHint ? 'Compte Google : ' + loginHint :
        'Connectez-vous avec le compte Google propriétaire de votre budget.');
    }).catch(() => {
      prepared = false; releaseAttempt();
      showGate('La connexion Google n’a pas pu être préparée. Vérifiez votre accès Internet puis réessayez.', true);
    }).finally(() => { preparing = null; });
    return preparing;
  }

  window.BudgetOAuth = Object.freeze({
    whenConnected: () => firstConnection,
    call: request => execute(request),
    signOut: () => {
      attempt++; forget(); releaseAttempt();
      showGate('Vous êtes déconnecté de BudgetSmart.');
    }
  });
  button.onclick = authorize;
  window.addEventListener('offline', () => {
    if (!gate.hidden) showGate('Une connexion Internet est nécessaire pour ouvrir votre budget.', true);
  });
  window.addEventListener('online', () => { if (!prepared) prepare(); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    document.querySelectorAll('.pwaInstall').forEach(item => { item.hidden = false; });
  });
  document.querySelectorAll('.pwaInstall').forEach(item => {
    item.onclick = async () => {
      if (!installPrompt) return;
      const prompt = installPrompt; installPrompt = null;
      document.querySelectorAll('.pwaInstall').forEach(element => { element.hidden = true; });
      try { await prompt.prompt(); } catch { /* Chrome's menu remains available. */ }
    };
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    document.querySelectorAll('.pwaInstall').forEach(item => { item.hidden = true; });
  });
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  prepare();
})();
