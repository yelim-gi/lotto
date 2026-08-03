export function verify(secret) {
  return Boolean(process.env.ADMIN_SYNC_SECRET) && secret === process.env.ADMIN_SYNC_SECRET;
}

function base() {
  const value = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value)) {
    throw new Error('SUPABASE_URL이 올바르지 않습니다. https://프로젝트ID.supabase.co 형식으로 설정하세요.');
  }
  return value;
}

function service() {
  const value = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  return value;
}

export async function db(path, options = {}) {
  const r = await fetch(`${base()}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: service(),
      Authorization: `Bearer ${service()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.message || j.error || `Supabase 오류 ${r.status}`);
  }
  return r.status === 204 ? null : r.json();
}

export function cleanDraw(x, source = 'manual') {
  const draw_no = Number(x.draw_no);
  const bonus_no = Number(x.bonus_no);
  const numbers = (x.numbers || []).map(Number).sort((a, b) => a - b);
  const draw_date = String(x.draw_date || x.date || '').slice(0, 10);

  if (!Number.isInteger(draw_no) || draw_no < 1) throw new Error('회차가 올바르지 않습니다.');
  if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some((n) => n < 1 || n > 45)) {
    throw new Error('당첨번호가 올바르지 않습니다.');
  }
  if (bonus_no < 1 || bonus_no > 45 || numbers.includes(bonus_no)) {
    throw new Error('보너스번호가 올바르지 않습니다.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draw_date)) throw new Error('추첨일이 올바르지 않습니다.');

  return {
    draw_no,
    draw_date,
    numbers,
    bonus_no,
    source,
    updated_at: new Date().toISOString(),
  };
}
