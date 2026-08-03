import { db } from './_lib.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validNums = (numbers) => Array.isArray(numbers) && numbers.length === 6 && new Set(numbers).size === 6 && numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= 45);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const clientId = String(req.query.client_id || '');
      if (!uuid.test(clientId)) return res.status(400).json({ error: '기기 식별값이 올바르지 않습니다.' });
      const rows = await db(`saved_tickets?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.desc`);
      return res.status(200).json({ items: rows || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const clientId = String(body.client_id || '');
      const id = String(body.id || '');
      const numbers = (body.numbers || []).map(Number).sort((a, b) => a - b);
      if (!uuid.test(clientId) || !uuid.test(id) || !validNums(numbers)) {
        return res.status(400).json({ error: '저장 정보가 올바르지 않습니다.' });
      }

      const ticketType = body.ticket_type === 'purchased' ? 'purchased' : 'saved';
      const targetDrawNo = ticketType === 'purchased' ? Number(body.target_draw_no) : null;
      if (ticketType === 'purchased' && (!Number.isInteger(targetDrawNo) || targetDrawNo < 1)) {
        return res.status(400).json({ error: '구매 회차가 올바르지 않습니다.' });
      }

      const payload = {
        id,
        client_id: clientId,
        user_id: null,
        label: String(body.label || '').slice(0, 120),
        target_draw_no: targetDrawNo,
        numbers,
        ticket_type: ticketType,
        created_at: body.created_at || new Date().toISOString()
      };

      const rows = await db('saved_tickets?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload)
      });
      return res.status(200).json({ item: rows?.[0] || payload });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const clientId = String(req.query.client_id || '');
      if (!uuid.test(id) || !uuid.test(clientId)) return res.status(400).json({ error: '삭제 정보가 올바르지 않습니다.' });
      await db(`saved_tickets?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || '저장 서버 오류' });
  }
}
