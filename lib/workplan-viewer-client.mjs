const SESSION_KEY = 'workplan-viewer-session';

function validSession(value) {
  return value && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now();
}

function unauthorizedError() {
  return Object.assign(new Error('Viewer session expired. Sign in again.'), {
    status: 401, code: 'VIEWER_UNAUTHORIZED',
  });
}

export function createViewerClient({
  storage = globalThis.sessionStorage,
  fetchImpl = globalThis.fetch,
  origin = globalThis.location.origin,
  onUnauthorized = () => {},
} = {}) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Viewer origin must be HTTP or HTTPS without credentials.');
  }
  const streams = new Set();
  let session = null;
  let generation = 0;
  let notified = false;
  try {
    const saved = JSON.parse(storage.getItem(SESSION_KEY));
    if (validSession(saved)) session = { token: saved.token, expiresAt: saved.expiresAt };
    else storage.removeItem(SESSION_KEY);
  } catch {
    storage.removeItem(SESSION_KEY);
  }

  function resolvePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
      || /[\\\s\u0000-\u001f\u007f]/.test(path)) {
      throw new Error('Viewer requests require a same-origin root-relative path.');
    }
    const url = new URL(path, base.origin);
    if (url.origin !== base.origin || url.username || url.password || url.hash) {
      throw new Error('Viewer requests require a same-origin path without credentials or fragments.');
    }
    return url.href;
  }

  function stop() {
    for (const stream of streams) stream.close();
  }

  function clearSession() {
    generation++;
    session = null;
    stop();
    storage.removeItem(SESSION_KEY);
  }

  function invalidate(expected = session) {
    if (expected !== session) return;
    clearSession();
    if (!notified) {
      notified = true;
      onUnauthorized();
    }
  }

  function hasSession() {
    if (session && !validSession(session)) invalidate();
    return session !== null;
  }

  function requireSession() {
    if (!hasSession()) {
      invalidate();
      throw unauthorizedError();
    }
    return session;
  }

  function fetchOptions(options = {}, current) {
    const headers = new Headers(options.headers);
    headers.delete('Cookie');
    if (current) headers.set('Authorization', `Bearer ${current.token}`);
    return {
      ...options, headers, credentials: 'omit', redirect: 'error', mode: 'same-origin',
      cache: 'no-store', referrerPolicy: 'no-referrer',
    };
  }

  function checkResponse(response) {
    if (response.redirected || response.type === 'opaqueredirect'
      || (response.status >= 300 && response.status < 400)
      || (response.url && new URL(response.url).origin !== base.origin)) {
      throw new Error('Viewer redirects are not allowed.');
    }
  }

  async function login(masterToken) {
    clearSession();
    const attempt = generation;
    if (typeof masterToken !== 'string' || !masterToken.trim()) {
      throw new Error('Enter the viewer token.');
    }
    const response = await fetchImpl(resolvePath('/api/session'), fetchOptions({
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: masterToken }),
    }));
    checkResponse(response);
    if (!response.ok) throw new Error('Viewer sign-in failed. Check the token and try again.');
    const result = await response.json();
    if (!validSession(result) || result.token === masterToken) {
      throw new Error('Viewer returned an invalid session.');
    }
    if (attempt !== generation) throw new Error('Viewer sign-in was cancelled.');
    const next = { token: result.token, expiresAt: result.expiresAt };
    storage.setItem(SESSION_KEY, JSON.stringify(next));
    session = next;
    notified = false;
  }

  async function request(path, options = {}) {
    const url = resolvePath(path);
    const current = requireSession();
    const response = await fetchImpl(url, fetchOptions(options, current));
    checkResponse(response);
    if (response.status === 401) {
      invalidate(current);
      throw unauthorizedError();
    }
    if (session !== current || !hasSession()) throw unauthorizedError();
    return response;
  }

  function stream(path) {
    const url = resolvePath(path);
    const current = requireSession();
    const target = new EventTarget();
    let closed = false;
    let controller;
    let reader;
    let reconnectTimer;
    let expiryTimer;
    let delay = 500;

    target.close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(expiryTimer);
      controller?.abort();
      if (reader) void reader.cancel().catch(() => {});
      streams.delete(target);
    };
    streams.add(target);

    function active() {
      if (closed) return false;
      if (session !== current || !hasSession()) {
        target.close();
        return false;
      }
      return true;
    }

    function expire() {
      if (!active()) return;
      expiryTimer = setTimeout(expire, Math.min(current.expiresAt - Date.now(), 2147483647));
    }

    function reconnect() {
      if (!active()) return;
      target.dispatchEvent(new Event('error'));
      if (!active()) return;
      reconnectTimer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 10000);
    }

    async function connect() {
      if (!active()) return;
      controller = new AbortController();
      let connectionReader;
      try {
        const response = await fetchImpl(url, fetchOptions({
          headers: { Accept: 'text/event-stream' }, signal: controller.signal,
        }, current));
        if (!active()) {
          await response.body?.cancel();
          return;
        }
        if (response.status === 401) {
          invalidate(current);
          return;
        }
        try {
          checkResponse(response);
        } catch {
          target.close();
          await response.body?.cancel();
          return;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status < 500) target.close();
          else reconnect();
          return;
        }
        if (!response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
          target.close();
          await response.body?.cancel();
          return;
        }
        reader = connectionReader = response.body.getReader();
        target.dispatchEvent(new Event('open'));
        const decoder = new TextDecoder();
        let line = '';
        let skipLF = false;
        let eventType = '';
        let data = [];

        function parseLine() {
          if (!line) {
            if (data.length && active()) {
              delay = 500;
              target.dispatchEvent(new MessageEvent(eventType || 'message', { data: data.join('\n') }));
            }
            eventType = '';
            data = [];
          } else if (!line.startsWith(':')) {
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'data') data.push(value);
            if (field === 'event') eventType = value;
          }
          line = '';
        }

        function parse(text) {
          for (const char of text) {
            if (closed) return;
            if (skipLF && char === '\n') { skipLF = false; continue; }
            skipLF = false;
            if (char === '\r' || char === '\n') {
              parseLine();
              skipLF = char === '\r';
            } else line += char;
          }
        }

        while (active()) {
          const { value, done } = await connectionReader.read();
          if (!active()) break;
          parse(done ? decoder.decode() : decoder.decode(value, { stream: true }));
          if (done) break;
        }
        reconnect();
      } catch {
        reconnect();
      } finally {
        connectionReader?.releaseLock();
        if (reader === connectionReader) reader = undefined;
      }
    }

    expire();
    queueMicrotask(connect);
    return target;
  }

  async function logout() {
    const current = session;
    clearSession();
    if (!current) return;
    try {
      await fetchImpl(resolvePath('/api/session'), fetchOptions({ method: 'DELETE' }, current));
    } catch {}
  }

  return { hasSession, login, request, stream, logout, stop };
}
