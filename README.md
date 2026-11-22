# 🌿 한의원 치료 후기 앱 (PWA)

치료를 마친 환자가 QR코드로 접속해 후기를 남기고, 원장님이 답글을 달 수 있는 앱입니다.
외부 라이브러리 없이 Node.js(18+)만으로 동작합니다.

## 실행
```bash
ADMIN_PASSWORD=나만의비밀번호 node server.js
# 환자용: http://localhost:3000/    관리자: http://localhost:3000/admin
```
- 후기 데이터는 `data/reviews.json`에 저장됩니다 (정기 백업 권장).
- **실제 환자가 쓰려면 HTTPS 주소로 배포해야 합니다** (PWA 설치/서비스워커 조건). Render, Railway, Fly.io 등 Node를 돌릴 수 있는 곳에 올리고 영구 디스크(Volume)에 `DATA_DIR`을 지정하세요.
- Render 배포: 저장소 연결 후 New → Blueprint 로 `render.yaml` 사용 (ADMIN_PASSWORD만 입력)
- 환경변수: `ADMIN_PASSWORD`(필수 변경), `SESSION_SECRET`(권장), `PORT`, `DATA_DIR`

## QR 코드
`/admin` 로그인 → **QR 코드** 탭에서 배포된 주소를 넣으면 QR 생성, 안내 포스터 인쇄, PNG 저장이 됩니다.

## 질문 바꾸기
`public/config.js` 한 파일에서 한의원 이름, 선택지, 질문 순서/문구를 수정합니다.

## 소통 구조
1. 환자가 후기 제출 → 기기에 비밀 토큰 저장 (이름·연락처 불필요)
2. 관리자가 후기별로 답글 작성
3. 환자는 앱의 "내 후기 답글 확인"에서 답글 확인

## 개인정보 유의
연락처(선택)를 받으면 개인정보 수집에 해당합니다. 사용 시 안내 문구와 보관 기간 정책을 정해 두세요.

## 텔레그램 새 후기 알림 (선택)
1. 텔레그램에서 `@BotFather` → `/newbot` 으로 봇을 만들고 **토큰**을 받습니다.
2. 직원방에 봇을 초대하고 방에서 아무 말이나 합니다.
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates` 를 열어 `"chat":{"id":...}` 의 숫자가 **채팅 ID**입니다 (그룹은 `-`로 시작).
4. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 환경변수를 설정합니다. (`PUBLIC_URL`은 Render에서 자동 인식)
- 알림에는 점수 요약만 가고, 후기 본문·이름·연락처는 포함되지 않습니다.
