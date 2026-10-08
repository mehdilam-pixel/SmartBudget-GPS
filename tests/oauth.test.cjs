// Private OAuth boundary and failure handling; synthetic tokens/responses only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'oauth.js'), 'utf8');
const SCOPES = ['spreadsheets', 'script.container.ui', 'script.external_request'].map(s => 'https://www.googleapis.com/auth/' + s);
const config = { clientId: '123456789-synthetic.apps.googleusercontent.com', apiUrl: 'https://script.googleapis.com/v1/scripts/TEST_PRIVATE_DEPLOYMENT:run' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const elements = new Map(), listeners = {}, timers = new Map(), clients = [], calls = [], installs = [{ hidden: true }, { hidden: true }];
  const storage = options.storage || new Map(), history = [], writes = [];
  let timer = 0, clock = 1000000, fetchHandler = options.fetchHandler;
  class Clock extends Date { static now() { return clock; } }
  const get = id => { if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', disabled: false }); return elements.get(id); };
  const sdk = { accounts: { oauth2: { initTokenClient: value => {
    clients.push(value); return { requestAccessToken: () => { calls.push({ popup: true }); if (options.popupError) value.error_callback({ type: options.popupError }); } };
  } } } };
  const ctx = {
    console, Date: Clock, AbortController, Event, URL, URLSearchParams,
    location: { hash: options.fragment || '', pathname: '/SmartBudget-GPS/', search: '?v=2.5.4' },
    history: { replaceState(_state, _title, url) { if (options.historyBlocked) throw Error('history blocked'); history.push(url); } },
    localStorage: {
      getItem(key) { if (options.storageBlocked) throw Error('storage blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (options.storageBlocked) throw Error('storage blocked'); writes.push([key, value]); storage.set(key, value); }
    },
    navigator: { onLine: true, serviceWorker: { register: async (...args) => { calls.push({ serviceWorker: args }); } } },
    document: { getElementById: get, querySelectorAll: () => installs, createElement: () => ({ remove() {} }), head: { appendChild(script) { ctx.google = sdk; queueMicrotask(() => script.onload?.()); } } },
    setTimeout: (fn, ms) => { const id = ++timer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => { listeners[name] = fn; }, dispatchEvent: e => listeners[e.type]?.(e),
    fetch: async (url, request) => {
      calls.push({ url, request });
      if (url === './config.json') return { ok: true, json: async () => options.invalidConfig || config };
      if (fetchHandler) return fetchHandler(url, request);
      const input = JSON.parse(request.body);
      return { ok: true, status: 200, json: async () => ({ done: true, response: { result: input.parameters[0] === null ? { ok: false, error: 'Requête invalide.' } : { ok: true, data: { returned: input.parameters[0].action } } } }) };
    }
  };
  if (!options.loadSdk) ctx.google = sdk;
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const expire = ms => { for (const [id, value] of [...timers]) if (value.ms === ms) { timers.delete(id); value.fn(); } };
  const tokenResponse = (overrides = {}) => ({ access_token: 'synthetic-access-token', expires_in: 3600, token_type: 'Bearer', scope: SCOPES.join(' '), ...overrides });
  const connect = async (overrides = {}) => { await tick(); get('googleConnect').onclick(); await clients.at(-1).callback(tokenResponse(overrides)); await tick(); };
  return { ctx, get, calls, clients, listeners, timers, installs, connect, expire, tokenResponse, storage, history, writes,
    setClock: value => { clock = value; }, setFetch: value => { fetchHandler = value; }, requests: () => calls.filter(c => c.url === config.apiUrl) };
}

test('Google authorization only starts from a click; null probe precedes PIN and carries correct API envelope', async () => {
  const h = harness(); await tick();
  assert.equal(h.clients.length, 0); assert.equal(h.get('googleConnect').disabled, false);
  let ready = false; h.ctx.BudgetOAuth.whenConnected().then(() => { ready = true; });
  await h.connect(); assert.equal(ready, true); assert.equal(h.get('googleLogin').hidden, true);
  const consent = h.clients[0]; assert.equal(consent.include_granted_scopes, false); assert.equal(consent.prompt, ''); assert.equal(consent.login_hint, undefined);
  assert.deepEqual(consent.scope.split(' '), SCOPES);
  const probe = h.requests()[0]; assert.deepEqual(JSON.parse(probe.request.body), { function: 'api_request', parameters: [null], devMode: false });
  assert.equal(probe.request.credentials, 'omit'); assert.equal(probe.request.cache, 'no-store');
  assert.equal(probe.request.headers.Authorization, 'Bearer synthetic-access-token');
  const result = await h.ctx.BudgetOAuth.call({ action: 'login', pin: '654321' });
  assert.equal(result.data.returned, 'login'); assert.equal(h.requests().length, 2);
  assert.equal(h.calls.some(c => c.url?.includes('script.google.com')), false);
});
test('denied permissions and missing scopes keep gate closed to the budget without an API call', async () => {
  const denied = harness(); await denied.connect({ error: 'access_denied' });
  assert.equal(denied.requests().length, 0); assert.equal(denied.get('googleLogin').hidden, false); assert.match(denied.get('googleError').textContent, /refusées/);
  const partial = harness(); await partial.connect({ scope: SCOPES[0] });
  assert.equal(partial.requests().length, 0); assert.match(partial.get('googleError').textContent, /permissions/);
  const short = harness(); await short.connect({ expires_in: 300 }); assert.equal(short.requests().length, 0);
});
test('popup blocked, closed, duplicate click, and late callback are recoverable', async () => {
  for (const type of ['popup_failed_to_open', 'popup_closed']) {
    const h = harness({ popupError: type }); await tick(); h.get('googleConnect').onclick();
    assert.equal(h.get('googleConnect').disabled, false); assert.equal(h.get('googleLogin').hidden, false); assert.equal(h.requests().length, 0);
  }
  const h = harness(); await tick(); h.get('googleConnect').onclick(); h.get('googleConnect').onclick(); assert.equal(h.clients.length, 1);
  h.expire(120000); assert.equal(h.get('googleConnect').disabled, false);
  await h.clients[0].callback(h.tokenResponse()); assert.equal(h.requests().length, 0);
  await h.connect(); assert.equal(h.get('googleLogin').hidden, true);
});
test('wrong owner / denied API / disabled API / missing scope leave a useful error and never expose PIN', async () => {
  for (const reason of [undefined, 'SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']) {
    const h = harness({ fetchHandler: async () => ({ ok: false, status: 403, json: async () => ({ error: { details: reason ? [{ reason }] : [] } }) }) });
    await h.connect(); assert.equal(h.get('googleLogin').hidden, false); assert.ok(h.get('googleError').textContent.length > 20);
    assert.equal(h.requests().length, 1); assert.equal(JSON.parse(h.requests()[0].request.body).parameters[0], null);
  }
});
test('Google expiry and offline state prevent sending a mutation; reconnect preserves normal API access', async () => {
  const h = harness(); await h.connect(); const before = h.requests().length;
  h.setClock(1000000 + 3300000); await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'add' }), /Reconnectez-vous/);
  assert.equal(h.requests().length, before); assert.equal(h.get('googleLogin').hidden, false);
  await h.connect(); h.ctx.navigator.onLine = false;
  await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'add' }), /Aucune opération/); assert.equal(h.requests().length, before + 1);
});
test('401 and execution-level permission errors invalidate Google session without retry', async () => {
  for (const execution of [false, true]) {
    const h = harness(); await h.connect();
    h.setFetch(async () => ({ ok: execution, status: execution ? 200 : 401, json: async () => ({ error: { code: 16 } }) }));
    await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'dashboard' }), /Session Google/);
    assert.equal(h.get('googleLogin').hidden, false); assert.equal(h.requests().length, 2);
    await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'add' }), /Reconnectez-vous/); assert.equal(h.requests().length, 2);
  }
});
test('network failure, malformed response and timeout warn about a possibly committed mutation and do not retry', async () => {
  for (const mode of ['network', 'json', 'shape', 'timeout']) {
    const h = harness(); await h.connect();
    h.setFetch(async (_url, request) => {
      if (mode === 'network') throw new Error('network failure');
      if (mode === 'timeout') return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
      return { ok: true, status: 200, json: async () => { if (mode === 'json') throw Error('invalid json'); return { done: true }; } };
    });
    const result = h.ctx.BudgetOAuth.call({ action: 'add', operation: { requestId: 'synthetic-request' } });
    if (mode === 'timeout') h.expire(55000);
    await assert.rejects(result, /peut déjà être enregistrée/); assert.equal(h.requests().length, 2);
  }
});
test('a response after sign-out cannot revive a session or be mistaken for a completed write', async () => {
  const h = harness(); await h.connect(); let complete;
  h.setFetch(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.ctx.BudgetOAuth.call({ action: 'add' });
  h.ctx.BudgetOAuth.signOut(); complete({ ok: true, json: async () => ({ done: true, response: { result: { ok: true } } }) });
  await assert.rejects(pending, /session Google a changé.*peut déjà être enregistrée/);
  assert.equal(h.get('googleLogin').hidden, false);
});
test('identical concurrent reads share one call, while later reads and all writes remain fresh', async () => {
  const h = harness(); await h.connect(); assert.equal(h.ctx.BudgetOAuth.isConnected(), true);
  const complete = []; h.setFetch(() => new Promise(resolve => complete.push(resolve)));
  const read = { action: 'operationContext', date: '2026-10-08' };
  const a = h.ctx.BudgetOAuth.call(read), b = h.ctx.BudgetOAuth.call(read);
  assert.equal(a, b); assert.equal(h.requests().length, 2);
  complete.shift()({ ok: true, status: 200, json: async () => ({ done: true, response: { result: { ok: true, data: { balance: 100 } } } }) });
  assert.equal((await a).data.balance, 100); await b;
  const fresh = h.ctx.BudgetOAuth.call(read); assert.equal(h.requests().length, 3);
  complete.shift()({ ok: true, status: 200, json: async () => ({ done: true, response: { result: { ok: true, data: { balance: 200 } } } }) });
  assert.equal((await fresh).data.balance, 200);
  const first = h.ctx.BudgetOAuth.call({ action: 'add', operation: { requestId: 'A' } });
  const second = h.ctx.BudgetOAuth.call({ action: 'add', operation: { requestId: 'A' } });
  assert.notEqual(first, second); assert.equal(h.requests().length, 5);
  for (const resolve of complete.splice(0)) resolve({ ok: true, status: 200, json: async () => ({ done: true, response: { result: { ok: true } } }) });
  await Promise.all([first, second]); h.ctx.BudgetOAuth.signOut(); assert.equal(h.ctx.BudgetOAuth.isConnected(), false);
});
test('failed shared reads are discarded and Google expiry is detected even when a background timer is suspended', async () => {
  const h = harness(); await h.connect(); let fail;
  h.setFetch(() => new Promise((_resolve, reject) => { fail = reject; }));
  const a = h.ctx.BudgetOAuth.call({ action: 'dashboard' }), b = h.ctx.BudgetOAuth.call({ action: 'dashboard' });
  fail(Error('network')); await Promise.all([assert.rejects(a), assert.rejects(b)]);
  h.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ done: true, response: { result: { ok: true } } }) }));
  await h.ctx.BudgetOAuth.call({ action: 'dashboard' }); assert.equal(h.requests().length, 3);
  h.setClock(1000000 + 3300000); assert.equal(h.ctx.BudgetOAuth.isConnected(), false);
  h.listeners.focus(); assert.equal(h.get('googleLogin').hidden, false);
  await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'dashboard' }), /Reconnectez-vous/); assert.equal(h.requests().length, 3);
});
test('Google runtime errors preserve meaningful backend error; 404 and 429 remain explicit', async () => {
  const h = harness(); await h.connect();
  h.setFetch(async () => ({ ok: true, json: async () => ({ error: { details: [{ errorMessage: 'Corrigez le journal à la ligne 2' }] } }) }));
  await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'dashboard' }), /Corrigez le journal/);
  for (const code of [404, 429, 503]) {
    h.setFetch(async () => ({ ok: false, status: code, json: async () => ({ error: {} }) }));
    await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'dashboard' }), code === 404 ? /introuvable/ : code === 429 ? /limite temporaire/ : /503/);
  }
  await assert.rejects(h.ctx.BudgetOAuth.call({ action: 'add' }), /peut déjà être enregistrée/);
});
test('configuration rejects token exfiltration endpoint; SDK loader and install controls work without header overlay', async () => {
  const invalid = harness({ invalidConfig: { ...config, apiUrl: 'https://example.invalid/collect' } }); await tick();
  assert.equal(invalid.clients.length, 0); assert.match(invalid.get('googleError').textContent, /préparée/);
  const h = harness({ loadSdk: true }); await tick(); await h.connect(); assert.equal(h.get('googleLogin').hidden, true);
  let prompts = 0; h.listeners.beforeinstallprompt({ preventDefault() {}, prompt: async () => { prompts++; } });
  assert.equal(h.installs[0].hidden, false); await h.installs[0].onclick(); assert.equal(prompts, 1); assert.equal(h.installs[1].hidden, true);
});
test('personal link remembers only the account preference, removes it from the URL and does not trigger authorization', async () => {
  const h = harness({ fragment: '#account=owner%40example.invalid&view=home' }); await tick();
  assert.equal(h.clients.length, 0); assert.equal(h.requests().length, 0);
  assert.deepEqual(h.writes, [['budgetsmart-google-account', 'owner@example.invalid']]);
  assert.deepEqual(h.history, ['/SmartBudget-GPS/?v=2.5.4#view=home']);
  await h.connect(); assert.equal(h.clients[0].login_hint, 'owner@example.invalid'); assert.equal(h.clients[0].prompt, '');
  assert.deepEqual(h.clients[0].scope.split(' '), SCOPES);
  await h.ctx.BudgetOAuth.call({ action: 'login', pin: '654321' });
  assert.equal(h.storage.size, 1); assert.equal(h.calls.some(c => c.url?.includes('owner')), false);
  assert.deepEqual(h.writes, [['budgetsmart-google-account', 'owner@example.invalid']]);
});
test('the account survives a reload and sign-out while Google tokens are never persisted', async () => {
  const first = harness({ fragment: '#account=owner%40example.invalid' }); await first.connect();
  first.ctx.BudgetOAuth.signOut();
  const next = harness({ storage: first.storage }); await next.connect();
  assert.equal(next.clients[0].login_hint, 'owner@example.invalid'); assert.equal(next.history.length, 0);
  next.ctx.BudgetOAuth.signOut(); await next.connect(); assert.equal(next.clients[1].login_hint, 'owner@example.invalid');
  assert.deepEqual([...next.storage], [['budgetsmart-google-account', 'owner@example.invalid']]); assert.equal(next.writes.length, 0);
});
test('invalid account input is ignored and blocked storage or history does not block connection', async () => {
  for (const value of ['not-an-email', '<img>@example.invalid', 'a'.repeat(250) + '@example.invalid']) {
    const h = harness({ fragment: '#account=' + encodeURIComponent(value) }); await h.connect();
    assert.equal(h.clients[0].login_hint, undefined); assert.equal(h.storage.size, 0);
    assert.deepEqual(h.history, ['/SmartBudget-GPS/?v=2.5.4']);
  }
  const fallback = harness({ fragment: '#account=invalid', storage: new Map([['budgetsmart-google-account', 'owner@example.invalid']]) });
  await fallback.connect(); assert.equal(fallback.clients[0].login_hint, 'owner@example.invalid'); assert.equal(fallback.writes.length, 0);
  const corrupt = harness({ storage: new Map([['budgetsmart-google-account', 'invalid']]) }); await corrupt.connect(); assert.equal(corrupt.clients[0].login_hint, undefined);
  for (const option of ['storageBlocked', 'historyBlocked']) {
    const h = harness({ [option]: true, fragment: '#account=owner%40example.invalid' }); await h.connect();
    assert.equal(h.clients[0].login_hint, 'owner@example.invalid'); assert.equal(h.get('googleLogin').hidden, true);
  }
});
test('production bundle has no iframe, demo payload, PIN, financial dataset or persistent Google token', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(/<iframe\b/i.test(html), false); assert.equal(html.includes('DEMO_API=async'), false);
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.equal(source.includes('sessionStorage'), false);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.equal(sw.includes('config.json'), false); assert.equal(sw.includes('script.googleapis.com'), false); assert.match(sw, /v2\.5\.4/);
});
