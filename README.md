# Twitch zkLogin Wallet Extension (DEVNET!!)

이 저장소는 Twitch OAuth 로그인 흐름을 Sui zkLogin 지갑에 연결하는 Chrome 확장 프로그램입니다. 사용자가 Twitch로 인증하면 확장 프로그램이 salt/랜덤니스/zk 증명을 획득하고, Devnet 상의 Sui 주소를 생성하여 트랜잭션 서명까지 제공합니다. twitch.tv 페이지 위에는 React 기반 오버레이가 렌더링되고, 브라우저 액션 팝업과 옵션 페이지를 통해 동일한 세션을 관리합니다.

## 핵심 스펙

- **플랫폼**: Chrome Manifest V3 확장 프로그램
- **프런트엔드**: React 19, TypeScript 5, Vite 6, SWC
- **Sui SDK**: `@mysten/sui` 1.31 (zkLogin, client, transactions 모듈)
- **상태 저장소**: `chrome.storage` (local/sync/session)
- **타깃 네트워크**: Sui Devnet
- **주요 기능**
  - Twitch OAuth → zkLogin 증명 생성 → Sui 주소 발급
  - Twitch 페이지에 표시되는 실시간 오버레이
  - 팝업 UI에서 계정, 트랜잭션, 오버레이 토글 관리
  - 옵션 페이지에서 Twitch 클라이언트 ID / Salt Service / zk Prover 설정

## 프로젝트 구조

```
poc_zklogin_2/
├─ README.md                ← 온보딩 가이드(이 문서)
│─ public/               ← 정적 자산 (manifest, config.json, dummy salt 등)
│─ src/
│  │─ background/        ← 서비스 워커 (Twitch 로그인, zk 증명, 트랜잭션 처리)
│  │─ content/           ← twitch.tv 오버레이 UI
│  │─ popup/             ← 브라우저 액션 팝업 UI
│  │─ options/           ← 확장 옵션 페이지
│  │─ shared/            ← 공용 타입, 메시지, 스토리지 유틸
│  │  └─ types/             ← ambient 타입 선언 (예: node:path)
│─ package.json          ← 프런트엔드 의존성 및 스크립트
│  └─ pnpm-lock.yaml      ← pnpm 락파일
```

## 사전 준비물

| 항목 | 비고 |
| --- | --- |
| Node.js 20 이상 | 네이티브 ES 모듈 및 최신 TypeScript를 사용합니다. |
| pnpm 9 이상 | `corepack enable` 로 활성화하거나 `npm install -g pnpm` 으로 설치하세요. |
| Chrome/Chromium | 개발자 모드 활성화 필요. |
| Twitch 개발자 계정 | OAuth 클라이언트 ID 발급용. |

## 설치 및 기본 검증

```bash
# 1. 저장소 클론 후 확장 루트로 이동
$ git clone https://github.com/Upsuider/poc_zklogin_2.git
$ cd poc_zklogin_2

# 2. 의존성 설치
$ pnpm install

# 3. 타입 검사 (기본 품질 게이트)
$ pnpm typecheck

# 4. 린트 (선택 사항)
$ pnpm lint
```

## Twitch OAuth & zkLogin 설정

1. **Twitch 애플리케이션 생성**
   - [Twitch 개발자 콘솔](https://dev.twitch.tv/console/apps)에서 새 App 생성
   - 발급된 **Client ID** 저장
   - OAuth Redirect URL: `https://<확장-ID>.chromiumapp.org/twitch`
     - 개발 중에는 확장을 로드할 때마다 ID가 달라질 수 있으므로, Chrome에서 `chrome://extensions` → 해당 확장 → **확장 ID** 확인

2. **기본 설정 주입**
   - `web/public/config.json` 편집 또는 새로 작성 (배포 시 번들됨)
     ```json
     {
       "twitchClientId": "your-client-id",
       "saltServiceUrl": "/dummy-salt-service.json",
       "zkProverUrl": "https://prover-dev.mystenlabs.com/v1"
     }
     ```
   - 로컬 개발 시 `dummy-salt-service.json` 이 기본 salt 를 제공합니다. 운영 환경에서는 실제 salt 서비스 URL을 입력하세요.

3. **런타임 옵션 페이지 사용**
   - 확장 로드 후 브라우저 액션 메뉴에서 **옵션**을 열어 설정을 변경할 수 있습니다. (`Twitch Client ID`, `Salt Service URL`, `zk Prover URL`)

## 개발 워크플로우

### 1) 번들 빌드 & 감시

```bash
pnpm build -- --watch
```
- `web/dist/` 경로에 Chrome 확장 번들이 생성됩니다.
- 파일 변경 시 자동으로 재빌드되며, Chrome에서는 “Reload” 버튼이 활성화됩니다.

### 2) Chrome 에서 로드

1. `chrome://extensions` 접속 후 **개발자 모드** ON
2. **Load unpacked** 클릭 → `/dist` 선택
3. 감시 빌드가 실행 중이면 변경 즉시 재빌드됩니다. Chrome에서 **Reload** 버튼을 눌러 반영하세요.

### 3) UI 디버깅 (선택)

UI를 브라우저 탭에서 빠르게 실험하고 싶다면 Vite 개발 서버를 사용할 수 있습니다.
```bash
pnpm dev
```
- 이 모드는 Chrome 확장 API (`chrome.runtime`, `chrome.identity`) 를 직접 사용할 수 없지만 React 컴포넌트 개발에 유용합니다.

## 코드 아키텍처 세부 설명

### Background Service Worker (`src/background/index.ts`)

- Twitch OAuth 흐름 → `jwtDecode` → salt 서비스 호출 → zk Prover API 호출 → Sui 주소/세션 생성
- `chrome.storage.session` 에 세션(`AccountSession`)을 저장하여 팝업/오버레이에서 재사용
- `SIGN_AND_EXECUTE` 요청 시 `@mysten/sui/transactions` 를 이용해 Programmable Transaction 생성 후 zkLogin 서명 수행
- React 프런트엔드와는 `MessageRequest`/`MessageResponse` 타입(강타입)으로 통신

### Content Script Overlay (`src/content/ui/App.tsx`)

- twitch.tv 페이지에 React 오버레이를 렌더링
- 계정 목록, 잔액, NFT, 최근 트랜잭션 등 계정 개요 표시
- SUI 전송 폼 및 Overlay 표시/숨김 토글 제공
- `chrome.storage.onChanged` 이벤트로 옵션 변경을 실시간 반영

### Popup (`src/popup/ui/PopupApp.tsx`)

- 확장 아이콘 클릭 시 노출되는 소형 UI
- 계정 선택, 오버레이 토글, 최근 활동 확인, Twitch 재로그인 트리거 제공

### Options Page (`src/options/ui/OptionsApp.tsx`)

- 읽기/쓰기 가능한 설정 관리
- Twitch Client ID, Salt Service URL, zk Prover URL 저장 (`chrome.storage.local`)
- 세션 캐시 비우기 기능 제공

### Shared 모듈 (`src/shared/…`)

- `messages.ts`: 메시지 타입 및 응답 형태 정의
- `types.ts`: 계정/세션/설정 타입과 zkLogin 관련 타입 헬퍼
- `storage.ts`: Chrome Storage 래퍼 + 기본 구성 로딩
- `encoding.ts`: base64 변환 등 유틸

## 타입 및 품질 책임

- `pnpm typecheck`: 필수 (Project References 이용)
- `pnpm lint`: ESLint (필요 시)
- React 19 환경에서 `JSX.Element` 대신 `ReactElement` 반환 타입을 사용합니다.
- zkLogin 입력(`StoredZkLoginProof`)은 `@mysten/sui` SDK 타입과 동기화되어야 합니다.

## 빌드 & 배포

```bash
pnpm build
```
- `web/dist/` 에 최종 산출물이 생성됩니다.
- 배포용 zip 생성: `cd web && zip -r ../twitch-zklogin-wallet.zip dist`
- Chrome Web Store 업로드 시 `manifest.json` 의 버전 필드를 갱신하세요.

## 디버깅 팁

| 상황 | 해결 방법 |
| --- | --- |
| Twitch 로그인 실패 (`startTwitchLogin failed`) | Options 페이지에서 Twitch Client ID 확인, Redirect URL 일치 여부 점검 |
| zk Prover 호출 실패 | Prover URL이 HTTPS 인지 확인, Devnet 전용 endpoint 사용 |
| 오버레이가 안 뜸 | 팝업에서 Overlay toggle 확인, Twitch 페이지에서 `window.chrome` 권한 확인, DevTools → Sources → `assets/content.js` 로드 여부 확인 |
| TypeScript `node:path` 오류 | `src/types/node-compat.d.ts` 가 삭제되지 않았는지 확인 |
| 세션 꼬임 | Options → “Clear cached zkLogin sessions” 실행 후 재로그인 |

## 참고 자료

- Sui zkLogin 공식 문서: <https://docs.sui.io/concepts/cryptography/zklogin>
- Mysten Labs zkLogin Prover: <https://docs.sui.io/concepts/cryptography/zklogin#run-the-proving-service-in-your-backend>
- Twitch Developer Console: <https://dev.twitch.tv/console/apps>
- zkLogin 감사 리포트: <https://github.com/sui-foundation/security-audits/blob/main/docs/zksecurity_zklogin-circuits.pdf>