# Lotto Data + Gemini Recommender

Vercel 배포용 Vite 프로젝트입니다. 통계 추천, Gemini AI 추천, 둘 다 보기, 내 번호 저장, 통계, 관리자 수동 회차 추가를 포함합니다.

## Vercel 환경변수

- `VITE_SUPABASE_URL`: `https://프로젝트ID.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: Supabase publishable/anon key
- `SUPABASE_URL`: 위 Project URL과 동일
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret/service role key
- `ADMIN_SYNC_SECRET`: 관리자 수동 업데이트 비밀번호
- `LOTTO_DATA_URL`: `https://smok95.github.io/lotto/results/all.json`
- `GEMINI_API_KEY`: Google AI Studio에서 발급한 Gemini API key
- `GEMINI_MODEL`: 기본값 `gemini-3.5-flash` (생략 가능)

`GEMINI_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`에는 절대 `VITE_`를 붙이지 마세요.

## Supabase

1. 새 Supabase 프로젝트를 만듭니다.
2. `supabase/schema.sql`을 SQL Editor에서 실행합니다.
3. Authentication > Providers에서 Anonymous Sign-ins를 켭니다.

## 배포

1. 이 폴더를 GitHub 저장소에 업로드합니다.
2. Vercel에서 저장소를 Import합니다.
3. Framework Preset은 Vite, Build Command는 `npm run build`, Output Directory는 `dist`입니다.
4. 위 환경변수를 Production/Preview/Development에 추가합니다.
5. Redeploy합니다.

## AI 추천 방식

브라우저는 전체/최근/미출현/번호쌍/조합 분포 요약과 통계 후보 조합을 Vercel 서버 함수로 보냅니다. 서버 함수가 Gemini API를 호출합니다. API 키는 브라우저로 전달되지 않습니다. Gemini는 제공된 데이터에 근거해 추세 지속 또는 평균 회귀 등의 조건부 시나리오를 세우고 번호와 선택 이유를 반환합니다.
