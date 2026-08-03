const MODEL=process.env.GEMINI_MODEL||'gemini-3.5-flash';
const validNumbers=nums=>Array.isArray(nums)&&nums.length===6&&new Set(nums).size===6&&nums.every(n=>Number.isInteger(n)&&n>=1&&n<=45);
const jsonFromText=text=>{const clean=String(text||'').replace(/^```json\s*/i,'').replace(/```$/,'').trim();return JSON.parse(clean);};
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST만 지원합니다.'});
  const key=process.env.GEMINI_API_KEY;if(!key)return res.status(500).json({error:'GEMINI_API_KEY가 설정되지 않았습니다.'});
  try{
    const {count=1,fixed=[],snapshot,candidates=[]}=req.body||{};
    const safeCount=Math.max(1,Math.min(10,Number(count)||1));
    const safeFixed=[...new Set((fixed||[]).map(Number))].filter(n=>n>=1&&n<=45).slice(0,5);
    const prompt=`당신은 한국 로또 6/45의 과거 데이터에서 관찰 가능한 변화와 시간 흐름을 해석하는 분석가다. 미래를 안다고 주장하지 말고, 제공된 데이터 밖의 근거를 만들지 마라.\n\n목표:\n1) 과거 전체, 최근 흐름, 장기 미출현, 동반 출현, 평균 회귀와 추세 지속이라는 서로 다른 가설을 비교한다.\n2) 다음 회차에 적용할 하나의 조건부 예측 시나리오를 선택한다.\n3) 그 시나리오에 맞는 서로 다른 숫자 6개짜리 조합 ${safeCount}개를 고른다.\n4) 각 조합의 이유는 실제 제공 데이터와 선택한 가설에 연결하여 2~3문장으로 쓴다. 막연한 '미래의 흐름', '운이 좋다' 같은 표현은 금지한다.\n5) 고정 번호 ${JSON.stringify(safeFixed)}는 모든 조합에 반드시 포함한다. 조합끼리 번호가 겹쳐도 된다.\n6) 후보 조합을 참고하되 필요하면 다른 유효 조합도 만들 수 있다.\n\n통계 요약:\n${JSON.stringify(snapshot)}\n\n통계 모델 후보:\n${JSON.stringify(candidates.slice(0,60))}\n\n반드시 JSON만 반환한다. 형식:\n{"scenario":"선택한 예측 가설 2~4문장","games":[{"numbers":[1,2,3,4,5,6],"reason":"데이터에 근거한 이유 2~3문장"}]}`;
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.75,responseMimeType:'application/json',maxOutputTokens:3000}})});
    const raw=await r.json();if(!r.ok)throw new Error(raw?.error?.message||`Gemini 오류 ${r.status}`);
    const text=raw?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    const parsed=jsonFromText(text);const games=(parsed.games||[]).filter(g=>validNumbers(g.numbers.map(Number))&&safeFixed.every(n=>g.numbers.map(Number).includes(n))).slice(0,safeCount).map(g=>({numbers:g.numbers.map(Number).sort((a,b)=>a-b),reason:String(g.reason||'').trim()}));
    if(games.length!==safeCount)throw new Error('Gemini가 유효한 조합을 충분히 반환하지 않았습니다. 다시 시도해주세요.');
    return res.status(200).json({scenario:String(parsed.scenario||'').trim(),games,model:MODEL});
  }catch(e){return res.status(500).json({error:e.message||'AI 추천에 실패했습니다.'});}
}
