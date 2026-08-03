const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const validNumbers = (nums) =>
  Array.isArray(nums) &&
  nums.length === 6 &&
  new Set(nums).size === 6 &&
  nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '';
}

function cleanJsonText(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callGemini({ key, prompt, generationConfig = {}, timeoutMs = 45000 }) {
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
        generationConfig: {
          // Gemini 3.5 Flash는 기본 사고 수준이 medium이다. 짧은 구조화 응답에서는
          // 내부 사고가 출력 토큰을 소진하지 않도록 minimal로 제한한다.
          thinkingConfig: { thinkingLevel: 'minimal' },
          ...generationConfig
        }
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
    if (finishReason === 'MAX_TOKENS') {
      const used = raw?.usageMetadata?.totalTokenCount;
      throw new Error(`Gemini 응답이 길이 제한으로 중단되었습니다${used ? ` (사용 토큰 ${used})` : ''}.`);
    }
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

async function selectCandidateIndexes({ key, candidateCount, safeCount, candidates, snapshot }) {
  // Gemini 출력 자체를 JSON으로 파싱하지 않는다. 아주 짧은 쉼표 구분 index만
  // 받아 숫자를 추출하므로, 문장이 일부 흔들려도 JSON 문자열 종료 오류가 없다.
  const prompt = `한국 로또 6/45 분석 과제다.
통계 요약과 후보를 비교해 다음 회차의 조건부 예측에 적합한 서로 다른 후보 index를 정확히 ${safeCount}개 선택하라.
새 번호를 만들지 마라. 설명, 괄호, 코드블록, JSON을 쓰지 말고 숫자 index만 쉼표로 구분해 한 줄로 답하라.
예시 형식: 0,3,7
허용 index 범위: 0부터 ${candidateCount - 1}까지.

통계 요약: ${JSON.stringify(snapshot)}
후보: ${JSON.stringify(candidates.map((candidate, index) => ({ index, n: candidate.numbers, s: candidate.score })))}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await callGemini({
        key,
        prompt,
        generationConfig: {
          maxOutputTokens: 128,
          temperature: 0.2
        },
        timeoutMs: 30000
      });

      const indexes = [...new Set((text.match(/\d+/g) || []).map(Number))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < candidateCount)
        .slice(0, safeCount);

      if (indexes.length !== safeCount) {
        throw new Error(`Gemini가 ${safeCount}개의 서로 다른 후보 index를 완성하지 않았습니다.`);
      }
      return indexes;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Gemini 후보 선택에 실패했습니다: ${lastError?.message || '알 수 없는 오류'}`);
}

async function createScenario({ key, snapshot, selected }) {
  const prompt = `한국 로또 6/45의 과거·최근 흐름을 해석해 다음 회차에 적용할 조건부 예측 시나리오를 한국어 2문장, 최대 180자로 작성하라.
제공된 자료 밖의 사실, 운세, 예언, 확정 표현은 금지한다. 추세 지속과 평균 회귀 중 어느 가설을 더 반영했는지 명확히 써라.
마크다운이나 JSON 없이 문장만 출력하라.

통계 요약: ${JSON.stringify(snapshot)}
선택 조합: ${JSON.stringify(selected.map((x) => x.numbers))}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await callGemini({
        key,
        prompt,
        generationConfig: { maxOutputTokens: 2048 },
        timeoutMs: 40000
      });
      const scenario = text.replace(/^['"“”]+|['"“”]+$/g, '').trim();
      if (!scenario) throw new Error('빈 시나리오가 반환되었습니다.');
      return scenario.slice(0, 500);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`AI 예측 시나리오 생성에 실패했습니다: ${lastError?.message || '알 수 없는 오류'}`);
}

async function createReason({ key, scenario, snapshot, candidate, gameNumber }) {
  const prompt = `한국 로또 6/45 데이터 분석가로서 아래 조합의 선택 이유를 한국어 1~2문장, 최대 180자로 작성하라.
제공된 수치나 관찰값을 최소 하나 포함하고, 운·기운·예언·당첨 보장 표현은 금지한다.
미래를 단정하지 말고 조건부 추론으로 써라. JSON, 마크다운, 제목 없이 이유 문장만 출력하라.

예측 시나리오: ${scenario}
게임: ${gameNumber}
조합: ${candidate.numbers.join(', ')}
통계 점수: ${candidate.score}
통계 요약: ${JSON.stringify(snapshot)}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await callGemini({
        key,
        prompt,
        generationConfig: { maxOutputTokens: 2048 },
        timeoutMs: 40000
      });
      const reason = text.replace(/^['"“”]+|['"“”]+$/g, '').trim();
      if (!reason) throw new Error('빈 이유가 반환되었습니다.');
      return reason.slice(0, 500);
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

    // 입력 후보를 너무 많이 보내면 모델이 불필요하게 오래 생각한다.
    // 요청 수보다 약간 많은 상위 후보만 전달한다.
    const candidateLimit = Math.min(16, Math.max(safeCount + 4, 10));
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
      .slice(0, candidateLimit);

    if (safeCandidates.length < safeCount) {
      throw new Error('AI가 선택할 통계 후보가 부족합니다. 다시 번호를 생성해주세요.');
    }

    const indexes = await selectCandidateIndexes({
      key,
      candidateCount: safeCandidates.length,
      safeCount,
      candidates: safeCandidates,
      snapshot
    });
    const selected = indexes.map((index) => safeCandidates[index]);
    const scenario = await createScenario({ key, snapshot, selected });

    // 게임별 설명은 독립적인 짧은 요청으로 생성한다. 하나가 길어져도 다른 게임의
    // 결과를 잘라먹지 않으며, 각 요청은 완전한 응답이 올 때까지 재시도한다.
    const games = await Promise.all(
      selected.map(async (candidate, index) => ({
        numbers: candidate.numbers,
        reason: await createReason({
          key,
          scenario,
          snapshot,
          candidate,
          gameNumber: index + 1
        })
      }))
    );

    return res.status(200).json({ scenario, games, model: MODEL });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AI 추천에 실패했습니다.' });
  }
}
