const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const validNumbers = (nums) =>
  Array.isArray(nums) &&
  nums.length === 6 &&
  new Set(nums).size === 6 &&
  nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scenario: {
      type: 'string',
      description: '제공된 데이터에 근거한 다음 회차 조건부 예측 시나리오. 2~4문장.'
    },
    games: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          numbers: {
            type: 'array',
            minItems: 6,
            maxItems: 6,
            items: { type: 'integer', minimum: 1, maximum: 45 }
          },
          reason: {
            type: 'string',
            description: '선택한 시나리오와 제공 데이터에 연결된 구체적인 선택 이유. 1~2문장.'
          }
        },
        required: ['numbers', 'reason']
      }
    }
  },
  required: ['scenario', 'games']
};

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

function parseJson(text) {
  const clean = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!clean) throw new Error('Gemini가 빈 응답을 반환했습니다.');
  return JSON.parse(clean);
}

async function requestGemini({ key, prompt, safeCount }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(key)}`;

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: attempt === 1 ? 0.55 : 0.25,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            ...responseSchema,
            properties: {
              ...responseSchema.properties,
              games: {
                ...responseSchema.properties.games,
                minItems: safeCount,
                maxItems: safeCount
              }
            }
          },
          maxOutputTokens: 8192
        }
      })
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(raw?.error?.message || `Gemini 오류 ${response.status}`);
    }

    const candidate = raw?.candidates?.[0];
    const finishReason = candidate?.finishReason || '';
    const text = extractText(raw);

    if (finishReason === 'MAX_TOKENS') {
      lastError = new Error('Gemini 응답이 길이 제한으로 잘렸습니다. 다시 시도합니다.');
      continue;
    }

    try {
      return parseJson(text);
    } catch (error) {
      lastError = new Error(`Gemini JSON 응답이 완성되지 않았습니다: ${error.message}`);
    }
  }

  throw lastError || new Error('Gemini 응답을 처리하지 못했습니다.');
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

    const prompt = `당신은 한국 로또 6/45의 과거 데이터를 시간 흐름에 따라 해석하는 분석가다.
제공된 데이터 밖의 사실을 만들지 말고, 미래를 확정적으로 단정하지 마라.

해야 할 일:
- 과거 전체 흐름, 최근 흐름, 장기 미출현, 동반 출현, 추세 지속과 평균 회귀 가능성을 비교한다.
- 다음 회차에 적용할 조건부 예측 시나리오 하나를 선택한다.
- 그 시나리오에 맞는 서로 다른 숫자 6개짜리 조합을 정확히 ${safeCount}개 선택한다.
- 각 이유는 실제 제공 데이터와 연결해 1~2문장으로 간결하게 쓴다.
- 막연한 운, 기운, 미래의 흐름 같은 근거 없는 표현은 금지한다.
- 고정 번호 ${JSON.stringify(safeFixed)}는 모든 조합에 반드시 포함한다.
- 조합끼리 같은 번호가 반복되는 것은 허용한다.

통계 요약:
${JSON.stringify(snapshot)}

통계 모델 후보:
${JSON.stringify(candidates.slice(0, 40))}`;

    const parsed = await requestGemini({ key, prompt, safeCount });
    const games = (parsed.games || [])
      .map((game) => ({
        numbers: (game.numbers || []).map(Number),
        reason: String(game.reason || '').trim()
      }))
      .filter(
        (game) =>
          validNumbers(game.numbers) &&
          safeFixed.every((number) => game.numbers.includes(number))
      )
      .slice(0, safeCount)
      .map((game) => ({
        numbers: game.numbers.sort((a, b) => a - b),
        reason: game.reason
      }));

    if (games.length !== safeCount) {
      throw new Error('Gemini가 유효한 조합을 충분히 반환하지 않았습니다. 다시 시도해주세요.');
    }

    return res.status(200).json({
      scenario: String(parsed.scenario || '').trim(),
      games,
      model: MODEL
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AI 추천에 실패했습니다.' });
  }
}
