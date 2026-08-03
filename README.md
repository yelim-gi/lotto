# 로또 데이터·AI 추천기

Vercel + Supabase + Gemini API용 Vite 프로젝트입니다.

## 이번 버전의 핵심 변경

- `내 번호`: 아직 구매하지 않은 마음에 드는 번호 보관
- `내 구매`: 실제 구매한 번호를 회차와 함께 등록
- 관리자에서 해당 회차 당첨번호를 추가하면 내 구매에서 자동 판정
  - 1등: 6개 일치
  - 2등: 5개 + 보너스 일치
  - 3등: 5개 일치
  - 4등: 4개 일치
  - 5등: 3개 일치
  - 그 외: 낙첨
  - 회차 미등록: 추첨 전
- 추천 결과마다 `내 번호 저장`과 `구매 등록` 버튼 분리
- Gemini 호출을 게임별 여러 번 호출하던 구조에서 **생성 1회당 API 1회**로 축소
- Gemini 429 무료 한도 오류를 팝업 원문 대신 한국어 안내로 처리
- 동일 조건 Gemini 결과를 10분간 브라우저 캐시하여 불필요한 요청 방지
- 무료 한도 대기시간 동안 재호출 방지

## Supabase 설정

1. Supabase 프로젝트에서 Anonymous Sign-Ins를 활성화합니다.
2. `supabase/schema.sql` 전체를 SQL Editor에서 다시 실행합니다.
   - 기존 테이블은 유지됩니다.
   - `saved_tickets.ticket_type` 컬럼이 추가됩니다.
3. 기존 저장번호는 자동으로 `내 번호(saved)`로 분류됩니다.

## Vercel 환경변수

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_OR_SERVICE_ROLE_KEY
ADMIN_SYNC_SECRET=YOUR_LONG_ADMIN_PASSWORD
LOTTO_DATA_URL=https://smok95.github.io/lotto/results/all.json
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
```

`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`에는 `VITE_`를 붙이지 마세요.
환경변수 변경 후에는 새 배포가 필요합니다.

## Gemini 무료 한도

무료 한도 자체는 코드로 늘릴 수 없습니다. 화면에 `limit 20`이 표시됐다면 해당 API 키/프로젝트의 무료 요청량을 사용한 것입니다. 이 버전은 한 번 생성할 때 요청을 1회만 사용하도록 줄였지만, 이미 소진된 한도는 Google이 안내한 대기시간 이후 다시 사용할 수 있습니다. 계속 많이 사용할 경우 Google 결제 연결 또는 한도가 다른 프로젝트/API 키가 필요합니다.

## 실행

```bash
npm install
npm run dev
```

배포 빌드:

```bash
npm run build
```
