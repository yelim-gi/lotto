# 로또 데이터 추천기

React + Vite로 만든 로또 6/45 전용 웹앱입니다. GitHub에 업로드한 뒤 Vercel에 연결하고, Supabase를 데이터 저장소로 사용합니다.

## 포함 기능
- 1~10게임 데이터 기반 추천
- 종합/최근 강세/장기 미출현/전체 빈도 모드
- 고정 번호 선택
- 내 번호 저장, 직접 입력, 회차별 당첨 확인
- 번호별 전체·최근 50회·미출현 통계
- 관리자 최신 회차 수동 등록 및 기존 회차 수정
- GitHub 공개 데이터 수동 동기화
- 새 회차 저장 즉시 추천·통계 반영

## 1. Supabase 전용 프로젝트 만들기
Supabase에서 `New project`를 눌러 이 앱 전용 프로젝트를 만듭니다. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.

Authentication → Providers 또는 Sign In / Providers에서 **Anonymous Sign-Ins**를 활성화합니다.

## 2. GitHub 업로드
이 폴더의 파일 전체를 저장소 최상단에 올립니다.

## 3. Vercel 배포
GitHub 저장소를 Vercel에 연결합니다. Vercel이 Vite를 자동 감지합니다.
- Build Command: `npm run build`
- Output Directory: `dist`

Vercel → Settings → Environment Variables에 다음 값을 등록합니다.
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ADMIN_SYNC_SECRET=길고_무작위인_관리비밀번호
LOTTO_DATA_URL=https://smok95.github.io/lotto/results/all.json
```
`VITE_`가 붙은 두 값만 브라우저에서 사용됩니다. 서버 함수는 별도의 `SUPABASE_URL`을 사용합니다. `SUPABASE_SERVICE_ROLE_KEY`와 `ADMIN_SYNC_SECRET`은 Vercel 서버 함수에서만 사용되므로 절대 `VITE_`를 붙이지 마세요.

## 4. 초기 1~1234회 데이터 넣기
로컬에서 한 번 실행합니다.
```bash
npm install
# macOS/Linux
export VITE_SUPABASE_URL="..."
export SUPABASE_SERVICE_ROLE_KEY="..."
npm run seed
```
Windows PowerShell:
```powershell
$env:VITE_SUPABASE_URL="..."
$env:SUPABASE_SERVICE_ROLE_KEY="..."
npm run seed
```
로컬 명령이 어렵다면 앱 배포 후 관리자 탭의 `GitHub 최신 데이터 동기화`를 눌러도 전체 데이터가 입력됩니다. 처음 실행은 약간 걸릴 수 있습니다.

## 5. 최신 회차 수동 입력
앱의 관리자 탭에서 관리 비밀번호, 회차, 추첨일, 번호 6개, 보너스번호를 입력합니다. 같은 회차가 이미 있으면 확인 후 수정(upsert)됩니다. 저장 직후 브라우저가 Supabase 데이터를 다시 불러와 통계와 이후 추천에 반영합니다.

## Vite와 Vercel 차이
Vite는 앱을 개발·빌드하는 도구이고 Vercel은 빌드된 앱을 인터넷에 배포하는 서비스입니다. 따라서 Vercel 배포 프로젝트여도 `VITE_SUPABASE_URL` 같은 Vite 공개 환경변수를 사용합니다.

## 주의
이 앱의 추천 점수는 과거 데이터 기반 가중치이며 실제 로또의 수학적 당첨 확률을 높이지 않습니다.
