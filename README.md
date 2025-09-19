# Twitch zkLogin Wallet Extension

이 프로젝트는 Twitch OAuth 인증을 Sui zkLogin 흐름과 연결한 **Chrome Manifest V3** 확장 프로그램입니다. 사용자는 Twitch 계정으로 로그인만 하면 Testnet 지갑을 자동 발급받고, 브라우저 내에서 zk 증명 생성과 트랜잭션 서명까지 한 번에 수행할 수 있습니다. 확장은 크게 세 가지 UI를 제공합니다.

- **twitch.tv 오버레이**: 방송 페이지 위에 실시간 계정·자산 정보를 띄워주고, SUI 전송 액션을 실행합니다.
- **팝업 & 옵션 페이지**: 세션 관리, 오버레이 토글, 뒤끝 연동 URL 등 환경설정을 제공합니다.
- **글로벌 상태 위젯**: 어떤 탭에서든(허용된 호스트에 한해) 현재 로그인 상태와 모의 NFT 민트 횟수를 확인할 수 있습니다.

## 기술 스택 & 하이라이트

- **React 19 / TypeScript 5 / Vite 6 (SWC)**
- **Sui SDK**: `@mysten/sui` 1.31 (`client`, `transactions`, `zklogin` 모듈 사용)
- **스토리지**: `chrome.storage.local`, `sync`, `session`
- **컨텐츠 스크립트 로더**: MV3 제약을 우회하기 위해 경량 loader(`content-loader.js`)가 실제 번들(`content.js`)을 동적으로 불러옵니다.
- **백엔드 목업 연동**: 로그인 성공 시 지갑 주소와 Twitch 사용자 ID를 외부 API로 POST 하는 실험용 훅이 포함되어 있습니다.

## 디렉터리 구조 (요약)

```
polymedia-zklogin-demo/
└─ web/
   ├─ public/                # manifest, config.json, dummy salt 등 정적 자산
   ├─ src/
   │  ├─ background/         # 서비스 워커 (OAuth, zk 증명, 서명)
   │  ├─ content/            # 오버레이 UI + 전역 위젯 + 로더 스크립트
   │  ├─ popup/              # 브라우저 액션 팝업
   │  ├─ options/            # 옵션 페이지
   │  ├─ shared/             # 타입, 메시지, 스토리지, 유틸
   │  └─ types/              # ambient 타입 선언 (예: node:path)
   ├─ dist/                  # `npm run build` 결과물 (Chrome에 로드)
   ├─ package.json
   └─ pnpm-lock.yaml
```

## 요구 사항

| 항목               | 설명                                    |
| ------------------ | --------------------------------------- |
| Node.js 20+        | 네이티브 ESM 및 최신 TypeScript 지원    |
| 패키지 매니저      | `pnpm` 권장 (`corepack enable` 후 사용) |
| 크롬/크로미움      | 개발자 모드에서 Unpacked 확장 로드      |
| Twitch 개발자 계정 | OAuth Client ID 발급                    |

## 최초 설정

```bash
# 저장소 클론 후 확장 프로젝트로 이동
$ git clone https://github.com/juzybits/polymedia-zklogin-demo.git
$ cd polymedia-zklogin-demo/web

# 의존성 설치 (pnpm 권장, npm 도 가능)
$ pnpm install

# 타입 체커 (기본 품질 게이트)
$ pnpm typecheck
```

## Twitch OAuth & zkLogin 설정

1. **Twitch 앱 생성**

   - [콘솔](https://dev.twitch.tv/console/apps)에서 새 애플리케이션 등록
   - 발급된 **Client ID** 기록
   - Redirect URI: `https://<확장-ID>.chromiumapp.org/twitch`
     - Unpacked 확장을 로드하면 `chrome://extensions` 페이지에서 ID를 확인할 수 있습니다.

2. **기본 설정 파일 업데이트** (`public/config.json`)

   ```jsonc
   {
     "twitchClientId": "your-client-id",
     "saltServiceUrl": "/dummy-salt-service.json",
     "zkProverUrl": "https://prover-dev.mystenlabs.com/v1",
     "backendRegistrationUrl": "" // 로그인 직후 POST 받을 API (없으면 빈 문자열)
   }
   ```

3. **런타임 옵션 페이지**
   - 팝업에서 ⚙️ → Options를 열어 Client ID, Salt Service, zk Prover, Backend URL을 수정할 수 있습니다.
   - Salt/Prover 설정을 바꾸면 다음 로그인부터 새로운 값이 사용됩니다.

## 개발 워크플로

### 1. 번들 빌드 및 감시

```bash
pnpm build -- --watch
```

- `dist/` 아래에 빌드 결과가 생성됩니다.
- 변경 시 자동으로 재빌드되며, Chrome 확장 페이지에서 **Reload** 버튼만 눌러주면 됩니다.

### 2. Chrome/Chromium에 로드

1. `chrome://extensions` → **Developer mode** 활성화
2. **Load unpacked** → `web/dist` 선택
3. 소스 수정 후 `pnpm build` 또는 watch 빌드가 동작 중이라면, 확장 페이지에서 **Reload** 클릭

### 3. (선택) Vite 개발 서버

UI 컴포넌트 단독 디버깅에는 개발 서버를 활용할 수 있습니다.

```bash
pnpm dev
```

- 이 모드에서는 Chrome 확장 API가 동작하지 않으므로 로그인을 비롯한 기능 테스트는 실제 확장 빌드에서 진행해야 합니다.

## 주요 아키텍처

### Background (`src/background/index.ts`)

- Twitch OAuth → ID Token 디코딩 → salt 서비스 호출 → zk Prover 호출 → `AccountSession` 생성
- 세션을 `chrome.storage.session`에 저장하여 팝업/오버레이에서 공유
- `SIGN_AND_EXECUTE` 요청 시 `@mysten/sui/transactions`로 Programmable Transaction 생성 후 zkLogin 서명, Testnet에 제출
- 로그인 성공 시 `backendRegistrationUrl`로 `{ walletAddress, twitchUserId, audience, registeredAt }`을 전송 (없는 경우 생략)

- NFT 업로드 요청 시 `nftUploadUrl`(기본: `https://zklogin.wiimdy.kr/api/walus/upload`)로 `FormData` (`walletAddress`, `provider`, `twitchUserId`, `audience`, `file`)를 POST

### Content Script (`src/content`)

- `content-loader.ts`: MV3 제약을 피해 `assets/content.js`를 동적 import
- `index.tsx`: twitch.tv에만 React 오버레이를 마운트하고, 모든 호스트에서 글로벌 상태 위젯을 초기화
- `channelPointsWidget.ts`: Twitch 채널 포인트 영역을 감시하며 모의 NFT 민트 수, 최근 claim 등을 구성
- `globalStatusWidget.ts`: OAuth 승인 창(`id.twitch.tv`), `about:blank`, `*.chromiumapp.org` 등 제한된 환경을 제외한 모든 페이지에 고정 카드 뷰 제공

### Popup & Options

- `popup/ui/PopupApp.tsx`: 계정 목록, 오버레이 토글, 채팅 고정 액션 등 제공
- `options/ui/OptionsApp.tsx`: 구성 저장, overlay sync, zkLogin 세션 캐시 삭제 기능 포함

### Shared 코드

- `shared/messages.ts`: 브라우저/서비스 워커 간 메시지 타입 정의
- `shared/types.ts`: `StoredZkLoginProof`, `AccountSession`, `ExtensionConfig` 등 핵심 타입
- `shared/storage.ts`: Chrome Storage 접근 및 `config.json` 로딩 래퍼
- `shared/encoding.ts`: base64 ↔︎ Uint8Array 변환 유틸

## 빌드 & 배포

```bash
pnpm build
```

- 산출물은 `web/dist`에 생성됩니다.
- 패키징 예시: `cd web && zip -r ../twitch-zklogin-wallet.zip dist`
- Chrome Web Store 업로드 전 `public/manifest.json`의 버전을 꼭 갱신하세요.

## QA & 디버깅 체크리스트

| 증상                                    | 확인 사항                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth 팝업에 위젯이 보임                | `globalStatusWidget`이 환경을 잘 필터링하는지, 최신 빌드인지 확인하세요. (현재 버전은 `id.twitch.tv`, `*.chromiumapp.org`, `about:blank`, `chrome://` 등을 자동 제외합니다.) |
| `startTwitchLogin failed`               | Options에서 Client ID, Redirect URI 일치 여부 확인 후 다시 로그인                                                                                                            |
| zk 프로버 오류                          | Prover URL이 HTTPS인지, Testnet endpoint인지 확인                                                                                                                            |
| 콘텐츠 스크립트 미적용                  | 확장 리로드 후 DevTools → Sources에서 `assets/content-loader.js`와 `assets/content.js`가 로드됐는지 확인                                                                     |
| TypeScript에서 Node 내장 모듈 인식 실패 | `src/types/node-compat.d.ts`가 존재하는지 점검                                                                                                                               |
| 세션 꼬임/초기화 문제                   | Options에서 “Clear cached zkLogin sessions” 실행 후 재로그인                                                                                                                 |

## 참고 링크

- Sui zkLogin: <https://docs.sui.io/concepts/cryptography/zklogin>
- Mysten Labs Prover 서비스: <https://docs.sui.io/concepts/cryptography/zklogin#run-the-proving-service-in-your-backend>
- Twitch Developer Console: <https://dev.twitch.tv/console/apps>
- zkLogin Audit 보고서: <https://github.com/sui-foundation/security-audits/blob/main/docs/zksecurity_zklogin-circuits.pdf>

필요한 질문이나 개선 아이디어가 있으면 이슈/PR로 공유해주세요. 😊
