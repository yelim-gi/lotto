# 필수 적용 순서

1. Supabase SQL Editor에서 `supabase/ticket-storage-fix.sql` 전체를 실행합니다.
2. Vercel 환경변수를 확인합니다.
   - `SUPABASE_URL=https://프로젝트ID.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=service_role 또는 sb_secret 키`
   - `GEMINI_API_KEY=...`
   - `GEMINI_MODEL=현재 사용 가능한 모델 ID`
3. GitHub에 이 프로젝트를 덮어올리고 Vercel에서 새 배포합니다.

## 변경점
- Supabase 익명 로그인 사용 안 함
- 브라우저 저장분과 Supabase 저장분을 병합하므로 원격 목록이 비어도 번호가 사라지지 않음
- 내 번호/구매 등록 시 같은 UUID를 로컬과 서버에서 사용
- Gemini 429 때 대체 모델을 자동 재호출하지 않아 요청량이 두 배로 늘지 않음
