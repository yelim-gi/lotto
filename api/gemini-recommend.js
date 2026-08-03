const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const validNumbers = (nums) =>
  Array.isArray(nums) &&
  nums.length === 6 &&
  new Set(nums).size === 6 &&
  nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
}

function cleanJsonText(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callGemini({ key, prompt, generationConfig, timeoutMs = 28000 }) {
  const endpoint = `${API_BASE}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig
      })
    });

    const rawText = await response.text();
    let raw;
    try {
      raw = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`Gemini 서버 응답을 읽지 못했습니다. HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(raw?.error?.message || `Gemini 오류 ${response.status}`);
    }

    const candidate = raw?.candidates?.[0];
    const finishReason = candidate?.finishReason || '';
    const text = extractText(raw);

    if (!text) throw new Error('Gemini가 빈 응답을 반환했습니다.');
    if (finishReason === 'MAX_TOKENS') throw new Error('Gemini 응답이 길이 제한으로 중단되었습니다.');
    if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
      throw new Error(`Gemini 응답이 완료되지 않았습니다: ${finishReason}`);
    }

    return text;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Gemini 응답 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function selectCandidates({ key, prompt, candidateCount, safeCount }) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenario: {
        type: 'string',
        description: '조건부 예측 시나리오를 120자 이내의 한 문단으로 작성'
      },
      selectedIndexes: {
        type: 'array',
        minItems: safeCount,
        maxItems: safeCount,
        items: { type: 'integer', minimum: 0, maximum: candidateCount - 1 }
      }
    },
    required: ['scenario', 'selectedIndexes']
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await callGemini({
        key,
        prompt,
        generationConfig: {
          temperature: attempt === 1 ? 0.55 : 0.25,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens: 1024
        }
      });

      const parsed = JSON.parse(cleanJsonText(text));
      const indexes = [...new Set((parsed.selectedIndexes || []).map(Number))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < candidateCount)
        .slice(0, safeCount);

      if (indexes.length !== safeCount) {
        throw new Error('Gemini가 필요한 수만큼 서로 다른 후보를 선택하지 않았습니다.');
      }

      return {
        scenario: String(parsed.scenario || '').trim(),
        indexes
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Gemini 후보 선택에 실패했습니다: ${lastError?.message || '알 수 없는 오류'}`);
}

async function createReason({ key, scenario, snapshot, candidate, gameNumber }) {
  const prompt = `당신은 한국 로또 6/45 데이터 분석가다.
아래 정보만 근거로 이 조합을 선택한 이유를 한국어 1~2문장, 최대 180자로 작성하라.
숫자나 관찰값을 최소 하나 포함하고, 막연한 운·기운·예언 표현은 쓰지 마라.
미래를 단정하지 말고 조건부 추론으로 표현하라.
JSON, 마크다운, 제목, 번호 매기기 없이 이유 문장만 출력하라.

예측 시나리오: ${scenario}
게임 번호: ${gameNumber}
선택 조합: ${candidate.numbers.join(', ')}
통계 점수: ${candidate.score}
통계 요약: ${JSON.stringify(snapshot)}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await callGemini({
        key,
        prompt,
        generationConfig: {
          temperature: attempt === 1 ? 0.45 : 0.2,
          maxOutputTokens: 320
        },
        timeoutMs: 24000
      });

      const reason = text.replace(/^['"“”]+|['"“”]+$/g, '').trim();
      if (!reason) throw new Error('빈 이유가 반환되었습니다.');
      if (reason.length > 420) throw new Error('이유가 지나치게 길게 반환되었습니다.');
      return reason;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`${gameNumber}게임 설명 생성에 실패했습니다: ${lastError?.message || '알 수 없는 오류'}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { count = 1, fixed = [], snapshot, candidates = [] } = req.body || {};
    const safeCount = Math.max(1, Math.min(10, Number(count) || 1));
    const safeFixed = [...new Set((fixed || []).map(Number))]
      .filter((n) => n >= 1 && n <= 45)
      .slice(0, 5);

    const safeCandidates = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        numbers: (candidate?.numbers || []).map(Number).sort((a, b) => a - b),
        score: Number(candidate?.score) || 0
      }))
      .filter(
        (candidate) =>
          validNumbers(candidate.numbers) &&
          safeFixed.every((number) => candidate.numbers.includes(number))
      )
      .slice(0, 24);

    if (safeCandidates.length < safeCount) {
      throw new Error('AI가 선택할 통계 후보가 부족합니다. 다시 번호를 생성해주세요.');
    }

    const selectionPrompt = `당신은 한국 로또 6/45의 과거 데이터를 시간 흐름에 따라 해석하는 분석가다.
제공된 데이터 밖의 사실을 만들지 말고 미래를 확정적으로 단정하지 마라.

해야 할 일:
1. 전체 흐름, 최근 흐름, 장기 미출현, 동반 출현, 추세 지속과 평균 회귀 가능성을 비교한다.
2. 다음 회차에 적용할 조건부 예측 시나리오를 120자 이내로 작성한다.
3. 아래 후보 중 시나리오에 가장 부합하는 서로 다른 후보 index를 정확히 ${safeCount}개 선택한다.
4. 번호 자체를 새로 만들지 말고 반드시 후보 index만 선택한다.
5. 고정 번호 ${JSON.stringify(safeFixed)}가 포함된 후보만 이미 제공되어 있다.

통계 요약:
${JSON.stringify(snapshot)}

후보 목록(index, numbers, score):
${JSON.stringify(safeCandidates.map((candidate, index) => ({ index, ...candidate })))}`;

    const selection = await selectCandidates({
      key,
      prompt: selectionPrompt,
      candidateCount: safeCandidates.length,
      safeCount
    });

    const selected = selection.indexes.map((index) => safeCandidates[index]);

    // 설명은 게임별로 별도 요청한다. 한 번의 긴 JSON 응답이 잘려 전체 결과가 깨지는 일을 막는다.
    const games = await Promise.all(
      selected.map(async (candidate, index) => ({
        numbers: candidate.numbers,
        reason: await createReason({
          key,
          scenario: selection.scenario,
          snapshot,
          candidate,
          gameNumber: index + 1
        })
      }))
    );

    return res.status(200).json({
      scenario: selection.scenario,
      games,
      model: MODEL
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AI 추천에 실패했습니다.' });
  }
}
