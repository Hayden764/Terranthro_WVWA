/**
 * API helpers for portal & admin pages.
 * Uses credentials: 'include' to send httpOnly cookies.
 */
const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (res.status === 401) {
    // If we get a 401 on a non-auth route, the session is expired
    if (!path.startsWith('/api/auth/') && !path.startsWith('/api/admin/login')) {
      window.dispatchEvent(new CustomEvent('session-expired'));
    }
  }

  return res;
}

export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);

  // Safely parse body — empty or non-JSON responses (e.g. Railway 502 during deploy)
  // should produce a meaningful error rather than crashing with "Unexpected end of JSON".
  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiPost(path, body) {
  return apiJson(path, { method: 'POST', body: JSON.stringify(body) });
}
