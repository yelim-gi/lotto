const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
export const isConfigured = Boolean(url && anon);
const key = 'lotto-anon-session';

function readSession() {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}
function saveSession(session) {
  if (session) localStorage.setItem(key, JSON.stringify(session));
  else localStorage.removeItem(key);
}
function isExpiring(session) {
  if (!session?.access_token) return true;
  const expiresAt = Number(session.expires_at || 0) * 1000;
  return !expiresAt || expiresAt - Date.now() < 60_000;
}

async function authRequest(path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { apikey: anon, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.message || data.error_description || data.error || `인증 요청 실패 ${response.status}`);
  return data;
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  try {
    const next = await authRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    saveSession(next);
    return next;
  } catch {
    saveSession(null);
    return null;
  }
}

export async function ensureAnonymousUser() {
  if (!isConfigured) return null;
  let session = readSession();
  if (session && isExpiring(session)) session = await refreshSession(session);
  if (session?.access_token && session?.user?.id) return session.user;
  session = await authRequest('/auth/v1/signup', { method: 'POST', body: JSON.stringify({}) });
  if (!session?.access_token || !session?.user?.id) {
    throw new Error('Supabase 익명 로그인이 꺼져 있습니다. Authentication → Providers → Anonymous Sign-Ins를 켜주세요.');
  }
  saveSession(session);
  return session.user;
}

async function request(path, options = {}, retried = false) {
  if (!isConfigured) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  await ensureAnonymousUser();
  const session = readSession();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${session?.access_token || anon}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && !retried) {
    const refreshed = await refreshSession(session);
    if (refreshed) return request(path, options, true);
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || data?.details || `Supabase 요청 실패 ${response.status}`;
    throw new Error(message);
  }
  return response.status === 204 ? null : data;
}

export async function select(table, query = '') {
  return request(`/rest/v1/${table}?${query}`, { headers: { Prefer: 'return=representation' } });
}
export async function insert(table, row) {
  const data = await request(`/rest/v1/${table}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row)
  });
  return data?.[0] || null;
}
export async function remove(table, id) {
  return request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' }
  });
}
