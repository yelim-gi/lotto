const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const validNumbers = (nums) =>
  Array.isArray(nums) && nums.length === 6 && new Set(nums).size === 6 &&
  nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
}

function getRetrySeconds(raw) {
  const details = raw?.error?.details || [];
  for (const item of details) {
    const delay = item?.retryDelay || item?.metadata?.retryDelay;
    if (typeof delay === 'string') {
      const value = Number(delay.replace(/s$/i, ''));
      if (Number.isFinite(value)) return Math.max(1, Math.ceil(value));
    }
  }
  const message = raw?.error?.message || '';
  const match = message.match(/retry in\s+([\d.]+)s/i);
  return match ? Math.max(1, Math.ceil(Number(match[1]))) : 60;
}

async function callGemini({ key, prompt, model = MODEL, timeoutMs = 40000 }) {
  const endpoint = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 700,
          thinkingConfig: { thinkingLevel: 'minimal' }
        }
      })
    });

    const rawText = await response.text();
    let raw = {};
    try { raw = rawText ? JSON.parse(rawText) : {}; } catch { /* Google 응답 자체가 비정상인 경우 */ }

    if (response.status === 429) {
      const error = new Error('Gemini 무료 사용 한도를 초과했습니다.');
      error.code = 'QUOTA_EXCEEDED';
      error.retryAfter = getRetrySeconds(raw);
      throw error;
    }
    if (!response.ok) throw new Error(raw?.error?.message || `Gemini 오류 ${response.status}`);

    const finishReason = raw?.candidates?.[0]?.finishReason || '';
    const text = extractText(raw);
    if (!text) throw new Error('Gemini가 빈 응답을 반환했습니다.');
    if (finishReason === 'MAX_TOKENS') throw new Error('Gemini 응답이 출력 한도에서 중단되었습니다. 다시 시도해주세요.');
    if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
      throw new Error(`Gemini 응답이 완료되지 않았습니다: ${finishReason}`);
    }
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Gemini 응답 시간이 초과되었습니다. 다시 시도해주세요.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseCompactResponse(text, candidates, count) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let scenario = '';
  const games = [];
  const used = new Set();

  for (const line of lines) {
    const scenarioMatch = line.match(/^SCENARIO\s*[:|]\s*(.+)$/i);
    if (scenarioMatch) {
      scenario = scenarioMatch[1].trim().slice(0, 260);
      continue;
    }
    const gameMatch = line.match(/^(?:GAME\s*)?(\d+)\s*[|:]\s*(\d+)\s*[|:]\s*(.+)$/i);
    if (!gameMatch) continue;
    const candidateIndex = Number(gameMatch[2]);
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidates.length || used.has(candidateIndex)) continue;
    used.add(candidateIndex);
    games.push({
      numbers: candidates[candidateIndex].numbers,
      reason: gameMatch[3].trim().slice(0, 240)
    });
    if (games.length === count) break;
  }

  if (!scenario) scenario = '최근 흐름과 장기 분포를 함께 보고, 추세 지속과 평균 회귀 가능성을 조건부로 반영했습니다.';
  if (games.length !== count) throw new Error(`Gemini가 ${count}개 조합을 끝까지 완성하지 못했습니다. 다시 시도해주세요.`);
  return { scenario, games };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });

  try {
    const { count = 1, fixed = [], snapshot = {}, candidates = [] } = req.body || {};
    const safeCount = Math.max(1, Math.min(10, Number(count) || 1));
    const safeFixed = [...new Set((fixed || []).map(Number))].filter((n) => n >= 1 && n <= 45).slice(0, 5);
    const safeCandidates = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        numbers: (candidate?.numbers || []).map(Number).sort((a, b) => a - b),
        score: Number(candidate?.score) || 0
      }))
      .filter((candidate) => validNumbers(candidate.numbers) && safeFixed.every((n) => candidate.numbers.includes(n)))
      .slice(0, Math.min(10, Math.max(safeCount, safeCount + 3)));

    if (safeCandidates.length < safeCount) throw new Error('AI가 선택할 통계 후보가 부족합니다. 다시 생성해주세요.');

    const compactSnapshot = {
      drawCount: snapshot.drawCount,
      latestDraw: snapshot.latestDraw,
      latestNumbers: snapshot.latestNumbers,
      overallHot: (snapshot.overallHot || []).slice(0, 6),
      recent30Hot: (snapshot.recent30Hot || []).slice(0, 6),
      recent100Hot: (snapshot.recent100Hot || []).slice(0, 6),
      longOverdue: (snapshot.longOverdue || []).slice(0, 6),
      pairLeaders: (snapshot.pairLeaders || []).slice(0, 8),
      sumMean: snapshot.sumMean,
      sumStd: snapshot.sumStd
    };

    const prompt = `한국 로또 6/45의 과거·현재 흐름을 바탕으로 다음 회차에 대한 조건부 예측 시나리오를 세우고 후보 중 ${safeCount}개를 선택하라.
반드시 제공된 후보 index만 선택하고 새 번호는 만들지 마라. 실제 당첨을 단정하거나 운세·예언 표현을 쓰지 마라.
응답은 아래 형식만 사용하고, 각 이유는 90자 이내 한 문장으로 작성하라. JSON과 마크다운은 금지한다.
SCENARIO|120자 이내 시나리오
GAME 1|후보index|선택 이유
GAME 2|후보index|선택 이유
필요한 GAME 줄은 정확히 ${safeCount}개다.

통계:${JSON.stringify(compactSnapshot)}
후보:${JSON.stringify(safeCandidates.map((x, index) => ({ index, n: x.numbers, score: x.score })))}`;

    const text = await callGemini({ key, prompt, model: MODEL });
    const parsed = parseCompactResponse(text, safeCandidates, safeCount);
    return res.status(200).json({ ...parsed, model: MODEL });
  } catch (error) {
    if (error?.code === 'QUOTA_EXCEEDED') {
      return res.status(429).json({
        code: 'QUOTA_EXCEEDED',
        error: 'Gemini 요청 제한에 걸렸습니다. 안내된 시간이 지난 뒤 다시 시도해주세요.',
        retryAfter: error.retryAfter || 60
      });
    }
    return res.status(500).json({ error: error.message || 'AI 추천에 실패했습니다.' });
  }
}
