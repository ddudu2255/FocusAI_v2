# Focus on (hanbakja) — Claude Code 작업 지시서

YouTube Shorts 단계적 개입 앱. 3인 팀 캡스톤 프로젝트. 팀원이 만든 hanbakja 저장소를 기반으로 기능을 다듬고, 이후 AI 개인화와 디지털 헬스케어 방향으로 확장한다. 원래 계획서: https://github.com/ddudu2255/FocusOn (쇼츠차단앱_상세개발계획서.md) — 기술 스택은 계획서와 다르게 가기로 했다.

## 작업 원칙

- 파일을 수정하기 전에 무엇을 왜 바꿀지 짧게 설명하고 승인을 받는다.
- 한 번에 한 단계(아래 Phase)씩 진행하고, 단계가 끝나면 검증 방법을 알려준다.
- 폰 조작(YouTube 재생, 스와이프, 접근성 켜기)은 사용자가 직접 한다. Claude는 adb logcat으로 결과를 확인한다.
- 화면 글, 메시지, 비밀번호, 계정 정보는 읽거나 저장하지 않는다 (viewId, 클래스 이름만 사용).
- API 키를 앱 코드에 넣지 않는다.
- 팀원 저장소를 복사한 사용자 개인 사본에서 작업한다. 원래 저장소에 push, PR, 릴리스 업로드는 하지 않는다. 결과물(코드, APK)은 사용자가 직접 올린다.
- 로컬 git 커밋은 Phase 단위로 하되, 커밋 전에 사용자에게 확인받는다.

## 확정된 방향

- 구조 유지: Next.js(TypeScript) 웹 화면 + Capacitor + 네이티브 접근성 서비스(Java).
- 통계·설정·리포트·Level 3 화면은 웹 유지. Level 1·2 개입과 잠금 화면은 YouTube 위 네이티브 오버레이로 바꾼다.
- 저장소는 SQLite 플러그인으로 옮긴다 (localStorage는 OS가 지울 수 있음).
- 대상은 Android만. 아이폰 웹앱·임시 터널은 더 손대지 않는다.
- 새 기능은 YouTube Shorts 기준으로 먼저 적용한다. Instagram Reels 감지는 지우지 않고 나중에 맞춘다.
- 패키지 이름은 `app.focuson.shorts`, 앱 표시 이름은 `ShortsAI` (2026-09-30 확정). 팀원 앱(`app.hanbakja.shorts`)과 별개 앱이라 둘 다 설치할 수 있다. 접근성 서비스는 새로 켜야 하고, 테스트할 때는 한쪽 서비스만 켠다 (둘 다 켜면 개입이 겹친다).

## 진행 상황 (2026-10-06)

| 단계 | 상태 |
|---|---|
| Phase 0 | 완료 |
| Phase 1 쇼츠 판별 | 완료. 기준은 ShortsDetection에서 실기기 검증됨. 이전 마커 4개와 ReelWatch 클래스 판정은 삭제 |
| Phase 2 세션 기록 | 구현 완료, 실기기 검증 전 |
| Phase 3 SQLite | 구현 완료, 실기기 검증 전 |
| Phase 4 리포트 알림 | 구현 완료, 실기기 검증 전 |
| Phase 5 Level 1·2 오버레이 | 구현 완료, 실기기 검증 전 (미디어 키 멈춤·재생 확인 필요) |
| Phase 6 잠금 오버레이 | 구현 완료, 실기기 검증 전 |
| APK 빌드·배포 | `npm run apk` / `npm run apk:debug`, 버전은 package.json 하나. 키스토어는 사용자가 만들 차례 |
| v0.8.0 (AI 제외 완성본) | 구현·폰 테스트 완료 (2026-10-06). 명세: docs/HANDOFF.md 5~6장 |
| v0.8.1 (테스트 피드백 반영) | 구현 완료, 폰 테스트 전 (PIP 로그 확인 필요). 목록: docs/HANDOFF.md 진행 상황 |
| v0.8.2 (PIP 나가기 최소 수정) | 완료 |
| v0.9.0 (AI 개인화) | 구현 완료, 문구 확인 완료, 폰 테스트 전. lib/ai.ts, GuardBandit.java |
| Phase 7 이후 (AI) | 지시 전까지 구현하지 않음. 학습용 기록(시간대, 요일, 개입 종류, 결과, 30분 내 재진입, feedback 칸)은 쌓이기 시작함 |

검증 목록: `release/NOTES.md`

### Phase 2~6 구현 요약 (현재 구조)

- 네이티브 (`android/app/src/main/java/app/focuson/shorts/`)
  - `ShortsGuardService`: 모든 앱의 창 변경을 받되 YouTube/Instagram ID와 패키지 이름만 본다. 감지 → 잠금 중이면 잠금 시트 / 개입 스위치 꺼짐이면 기록만 / Level 1·2면 YouTube 위 바텀시트 / Level 3·Instagram이면 이전처럼 앱 화면. 1초 틱으로 화면 꺼짐·다른 앱 이동을 확인.
  - `ShortsSessionTracker`: ShortsDetection 상태 기계를 Java로 옮김. 종료 시각은 플레이어가 처음 안 보인 시각.
  - 나가기: 세션을 바로 끝내고 BACK, 0.8초 뒤에도 쇼츠면 HOME. 그 사이 쇼츠 아닌 화면을 봤는지로 "BACK 실패"와 "다시 들어옴"을 구분.
  - 다른 앱 창 이벤트(토스트 포함)는 실제 앞 화면을 다시 확인한 뒤에만 세션을 끝낸다.
  - `GuardState`: 세션·개입·잠금 시도 대기열(JSON), 날짜별 네이티브 사용 초(최근 3일), blocked_until, 웹이 넘긴 기준 시간과 웹 측 초. 웹이 SQLite에 저장한 뒤 ack 해야 지운다.
  - `GuardOverlay`: TYPE_ACCESSIBILITY_OVERLAY + FLAG_NOT_FOCUSABLE, 코드로 만든 어두운 바텀시트(250ms 애니메이션). 텍스트 입력 없음.
  - `GuardNotifier`: 잠금 중 상태바 카운트다운 (setUsesChronometer + setChronometerCountDown).
  - `GuardTime`: 자정 분할, Level 구간 (단위 테스트).
  - 접근성 설정에서 packageNames 필터 제거 (다른 앱 이동 감지용).
- 웹
  - `lib/db.ts`: @capacitor-community/sqlite. 표 sessions, interventions, lock_attempts, settings(키-값). 첫 실행 때 localStorage `hanbakja.v1` 이관 후 `hanbakja.v1.migrated`로 보관.
  - `lib/persist.ts`: 안드로이드는 SQLite(쓰기 순서 보장), 브라우저는 localStorage.
  - `lib/notify.ts`: @capacitor/local-notifications 매일 반복 예약, 누르면 /report.
  - `components/guard-bridge.tsx`: 1.5초마다 sync(기준 시간·웹 초 전달, 대기열 수신) → SQLite 저장 → ack.
  - Level은 서비스가 감지 순간 정한다 (네이티브 세션 초 + 웹 초). Level 3 화면도 그 값을 쓴다.
  - 기록 손상 시 전체가 아니라 틀린 줄만 버린다.
  - 개입 스위치를 꺼도 사용 시간은 기록한다 (AI 기준선 데이터).

## 현재 코드 파악 (Phase 0 시점, 일부는 위 구현으로 바뀜)

### 네이티브 (android/app/src/main/java/app/focuson/shorts/)

- ShortsGuardService.java: 접근성 서비스. 감지 → 미디어 일시정지 → BACK 반복 → YouTube 프로세스 종료 → 앱 열기. 시청 선택 시 youtube.com/shorts를 새로 연다. 1초마다 tickWatch로 시청 초를 센다. 로그(Log) 호출은 하나도 없다.
- GuardScreens.java: 판별. YouTube 마커 reel_player_page, reel_player_underlay, reel_player_container, reel_watch_fragment를 부분 문자열로 비교. Activity 클래스 이름에 reelwatch 포함 시 쇼츠. selectedTabKind는 정의만 있고 미사용.
- GuardState.java: SharedPreferences(`hanbakja_guard`). 모드(idle/prompting/watching), 대상, suppress, 시청 초(날짜 없이 한 칸 누적), 차단 스위치.
- GuardPlugin.java: 웹↔네이티브 연결 (getStatus, setBlocker, takeWatch, finish, openSettings). 플러그인 이름 `HanbakjaGuard`. isServiceEnabled는 getPackageName()으로 ID를 만들어 패키지 이름 변경에 자동으로 따라간다.
- 재진입 방지는 되어 있음 (watching 상태면 개입 생략, 닫은 직후 3초 suppress).

### 웹 저장 (Phase 0에서 확인)

- 모든 기록이 localStorage 키 `hanbakja.v1` 하나에 JSON 통째로 저장된다 (lib/storage.ts). 구성: settings, usageLogs, interventions, activeSession, block, lastNotifiedDate.
- 바뀔 때마다 JSON 전체를 다시 쓴다 (시뮬레이션 피드에서는 0.5초마다).
- 불러올 때 기록 하나라도 형식이 틀리면 전체를 손상으로 보고 빈 데이터로 시작한다 (전부 아니면 전무).
- sessionStorage: `hanbakja-guard-session`(시청 선택 후 보는 중 표시), `hanbakja-block-lock`(차단 기록 중복 방지).
- 개입 스위치는 네이티브 SharedPreferences. 웹 대체용으로 localStorage `hanbakja.blocker`.
- Capacitor Preferences는 쓰지 않는다.
- 기록 형태 (lib/types.ts):
  - UsageLog: usageId, date, startTime, endTime, duration(초), clipCount
  - InterventionLog: interventionId, timestamp, date, level, reason, reasonNote(기타 입력), alternativeAction, alternativeCompleted, reEntered, blocked, blockDuration, usageSeconds, outcome(exit / watch / force-quit / timed-block / blocked-retry)
  - 시각·요일은 timestamp에서 계산 가능.

### Level 판정

- /watch 화면이 열릴 때 오늘 날짜 usageLogs의 duration 합으로 정한다 (levelForUsage, lib/logic.ts).
- level1Threshold(기본 10분) 미만 → Level 1, level3Threshold(기본 20분) 미만 → Level 2, 그 이상 → Level 3.
- level2Threshold는 불러올 때 level3Threshold로 덮여 실제로는 쓰이지 않는다.

### takeWatch 흐름

- components/guard-bridge.tsx가 1.5초마다 getStatus → pendingTarget이 있으면 /watch?guard=… 로 이동 → takeWatch로 초를 가져간다.
- 시청 선택 표시(sessionStorage)가 있으면 진행 중 세션에 더하고, 없으면 가져간 시점의 오늘 날짜로 새 기록을 만든다. ended가 오면 세션 마감.
- 문제: 네이티브 초에 날짜가 없어 앱이 꺼진 동안 본 시간은 다음에 앱을 연 날짜로 들어간다. sessionStorage 표시는 WebView가 다시 뜨면 사라진다. 네이티브는 "시청"을 고른 뒤의 시간만 센다. 실제 YouTube에서 clipCount는 사실상 1.

### 차단 (Level 3)

- 차단 상태(block.until ISO, minutes)는 웹 localStorage에만 있다. 네이티브는 모른다.
- 차단 중 쇼츠 진입 시 평소처럼 BACK 반복 + YouTube 종료 + 앱 열기 → 웹이 차단 화면을 보여주고 "차단 중 다시 열기"(blocked-retry)를 기록 → finish("block").
- force-quit와 timed-block은 네이티브에서 모두 leave로 처리된다.

### 리포트 알림

- 웹 Notification API로, 앱이 열려 있을 때 15초마다 확인한다. Capacitor WebView에는 이 API가 없을 가능성이 커 안드로이드에서는 사실상 동작하지 않는다 (Phase 4에서 교체).

### 빌드 환경 (Phase 0 확인)

- Node 24.14, npm 11.9, JDK 21(Amazon Corretto, JAVA_HOME), Gradle 8.14.3, AGP 8.13.0, Capacitor 8.5, compileSdk/targetSdk 36, minSdk 24.
- npm install → npm run build → npx cap sync android → gradlew assembleDebug 모두 성공. 단위 테스트 7개 통과.
- ANDROID_HOME이 비어 있어 android/local.properties에 sdk.dir을 적어둔다 (git 제외 파일).
- adb는 PATH에 없다: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

### 검증된 쇼츠 판별 기준 (사용자의 ShortsDetection 프로젝트, 실기기 SM-S936N)

접두어 `com.google.android.youtube:id/`

- 쇼츠에만 있음: reel_recycler, reel_player_page_container
- 롱폼에만 있음: watch_player, watch_panel, watch_list, player_overlays, metapanel_overlay_recycler_view
- 사용 금지: reel_time_bar (롱폼에도 존재), reel_feedback_play / reel_feedback_pause (탭할 때만 잠깐 나타남)
- 규칙: 쇼츠 ID가 isVisibleToUser 이고, 롱폼 ID는 하나도 안 보일 때만 쇼츠
- 롱폼→쇼츠 전환 애니메이션 중에는 reel_recycler와 watch_player가 동시에 보인다. 롱폼 제외 규칙이 이 순간의 오탐을 막으므로 제거하지 않는다.
- 판별은 findAccessibilityNodeInfosByViewId로 필요한 ID만 조회한다 (트리 전체 순회 금지)
- 감지 확인된 진입 경로: 하단 Shorts 탭, 롱폼 아래 쇼츠, 홈 피드 쇼츠 칸, 검색 결과 쇼츠, 채널 Shorts 탭
- 오탐 없음 확인: 롱폼 재생, 홈 피드, 검색, 채널 쇼츠 목록(썸네일 격자)
- 홈 런처 패키지: com.sec.android.app.launcher
- 미검증: 롱폼 미니플레이어가 떠 있을 때 쇼츠 진입, 공유 시트·계정 선택 창, 댓글 입력 중 키보드

참고 코드: ShortsDetection 프로젝트의 detector/ShortsViewIds.kt, ShortsDetector.kt, ShortsSessionTracker.kt, overlay/ShortsPopupOverlay.kt

## Phase 0. 현재 상태 파악 (코드 수정 없음) — 완료 (2026-09-30)

- 웹 쪽 lib/logic.ts와 저장 관련 코드를 읽고 보고한다: 기록을 어디에(localStorage / Preferences / 기타) 어떤 형태로 저장하는지, Level 판정과 takeWatch 결과를 어떻게 쓰는지, 차단(Level 3) 상태를 어디서 관리하는지.
- 빌드가 되는지 확인한다 (npm install → npm run build → npx cap sync android → gradlew assembleDebug). Gradle·JDK 버전 문제가 있으면 보고한다.
- 결과를 이 파일의 "현재 코드 파악"에 추가한다.

## Phase 1. 쇼츠 판별 보강 — 완료

- GuardScreens / ShortsGuardService의 YouTube 판별을 위 "검증된 판별 기준"으로 바꾼다.
  - 부분 문자열 비교 → 정확한 ID 비교
  - isVisibleToUser 확인, 롱폼 ID 제외 규칙 추가
  - 트리 순회(walk, 최대 800노드) → findAccessibilityNodeInfosByViewId
- 기존 마커(reel_player_page 등)는 바로 지우지 말고, 디버그 로그로 실제 화면에 나타나는지 확인한 뒤 결정한다.
- Instagram 판별은 건드리지 않는다.
- 검증: 위 진입 경로 5가지 감지, 롱폼·홈·검색 오탐 없음, 쇼츠→롱폼 전환 직후 오탐 없음.

## Phase 2. 시청 기록을 세션 단위로 — 구현 완료 (실기기 검증 전)

- 지금은 시청 초를 날짜 없이 한 칸에 누적한다. AI 학습에 쓰려면 세션마다 시작·종료 시각이 필요하다.
- 네이티브에서 세션(시작 시각, 종료 시각, 대상 앱)을 기록하고, 웹이 가져가서 저장하도록 바꾼다. 종료 시각은 쇼츠가 실제로 끝난 시각으로 한다.
- 날짜가 바뀌는 세션(자정 걸침)을 날짜별로 나눠 계산한다.
- 기존 takeWatch를 쓰는 웹 코드와 호환되게 바꾸거나 함께 수정한다.

## Phase 3. 저장소를 SQLite로 — 구현 완료 (실기기 검증 전)

- @capacitor-community/sqlite (또는 동급 SQLite 플러그인)로 옮긴다.
- 기존 저장 데이터는 첫 실행 때 이관한다.
- 테이블 초안 (확정 아님, Phase 0 결과를 보고 조정):
  - sessions: id, target, started_at, ended_at, duration_sec
  - interventions: id, created_at, hour, weekday, level, reason, intervention_type, outcome(leave/watch/block), block_minutes, reentered_within_30min, feedback(helpful/not/null)
  - lock_attempts: id, created_at, remaining_sec
  - settings: level 기준 시간, 리포트 알림 시각 등
- 통계 화면이 SQLite에서 읽도록 바꾼다.

## Phase 4. 리포트 예약 알림 — 구현 완료 (실기기 검증 전)

- 앱이 꺼져 있어도 매일 설정한 시각에 알림이 오도록 Capacitor 로컬 알림 플러그인으로 예약한다.
- 알림 문구는 "오늘 리포트가 준비됐어요" 정도로 두고, 탭하면 앱이 열리며 통계를 계산한다.

## Phase 5. Level 1·2 네이티브 오버레이 — 구현 완료 (실기기 검증 전)

- 목표: 앱 전환 없이 YouTube 위에 선택지가 자연스럽게 올라오게 한다.
- 서비스가 감지 순간 Level을 알아야 하므로, 웹이 현재 Level·누적 시간을 GuardPlugin으로 SharedPreferences에 미리 넘겨둔다.
- 흐름:
  - 감지 → 미디어 일시정지 키 → 배경이 서서히 어두워지고 아래에서 바텀시트가 올라옴 (translationY 애니메이션 약 250ms)
  - 이유 6개는 큰 버튼(칩), 나가기 버튼은 항상 같은 위치
  - Level 1: 이유 선택 → 같은 시트 안에서 5초 카운트다운 → 시트가 내려가고 재생 키로 보던 영상 이어서 재생
  - Level 2: 이유 선택 → 시트 내용만 대체행동 카드로 바뀜 → 시청/나가기 선택
  - 나가기: BACK, 0.8초 뒤에도 쇼츠면 HOME
- Level 3(강제 종료)은 지금의 종료 흐름(BACK 반복 + YouTube 종료 + 앱 열기)을 그대로 쓴다.
- 오버레이는 TYPE_ACCESSIBILITY_OVERLAY + FLAG_NOT_FOCUSABLE (포커스를 가져가면 감지가 YouTube로 유지되지 않음). 텍스트 입력은 넣지 않는다.
- 결과(이유, Level, 개입 종류, outcome)는 SharedPreferences에 쌓아두고 웹이 가져가 SQLite에 저장한다.
- 어두운 배경 + 밝은 글씨로 쇼츠 화면과 톤을 맞춘다.
- 주의: 나가기 직후 1초 안에 다시 쇼츠를 누르면 팝업이 안 뜨는 문제가 ShortsDetection에서 있었다. 나가기 순간 세션을 바로 종료하고, 확인 시점에 "BACK 실패"와 "다시 들어옴"을 구분한다 (그 사이 쇼츠 아닌 화면을 봤는지로 판단).
- 검증: 미디어 키로 YouTube 재생이 실제로 멈추고 이어지는지 갤럭시에서 확인.

## Phase 6. 잠금 오버레이 (Level 3 시간 차단) — 구현 완료 (실기기 검증 전)

- GuardState에 blocked_until(실제 시각, currentTimeMillis) 저장. GuardPlugin.finish에서 "block"일 때 분 단위 시간을 받아 설정.
- onTargetScreen 맨 앞에서 잠금 확인 → 잠금 중이면 앱 전환 없이 잠금 오버레이 표시.
- 잠금 오버레이: "쇼츠 잠금 중" + 1초마다 줄어드는 남은 시간 + 나가기 버튼만 (그래도 보기 버튼 없음). 나가기 또는 몇 초 후 BACK. YouTube 강제 종료는 하지 않는다.
- 잠금 시작 시 상태바 알림에 카운트다운 표시 (setUsesChronometer + setChronometerCountDown).
- 잠금 중 시도는 lock_attempts에 기록 (리포트에 "잠금 중 N번 시도" 표시).

## Phase 7 이후 (방향만 정함, 세부 설계 미정 — 지시 전까지 구현하지 않음)

- AI 개입 개인화: 이유·시간대별로 어떤 개입이 효과적인지 멀티암드 밴딧으로 학습. 보상 = 나가기 선택 / 30분 내 재진입 없음. 웹에서 계산해 "정책표"를 GuardPlugin으로 네이티브에 넘기고, 서비스는 표만 읽어 즉시 결정.
- 설명 표시와 피드백: 개입 화면에 이유 한 줄("평소 이 시간에 오래 보셨어요") + 도움 됐어요/아니에요 버튼.
- 위험 시간대 예측: 규칙 기반으로 시작, 데이터가 쌓이면 간단한 모델로.
- 이유별 대체 활동: 심심해서 → 관심 주제 지식 카드, 습관적으로 → 내 공부 자료 문제 1개, 스트레스 → 호흡, 잠들 시간 근처 → 수면 유도. 카드·문제는 끝이 정해진 분량(1장, 1문제). 앱이 열려 있을 때 미리 만들어 저장해두고 개입 때 바로 표시.
- 카드 생성용 작은 서버(서버리스). 화면 내용이 아닌 사용자가 올린 자료와 집계 통계만 보낸다.
- Health Connect 수면 데이터 연동 (권한 이전 30일까지만 읽힘).
- 의료 효과를 주장하는 문구(치료, 진단)는 쓰지 않는다. "디지털 웰빙", "건강한 사용 습관 관리"로 표현.

## 검증 시나리오 (공통)

- adb logcat으로 확인. 로그 태그: `ShortsAIGuard` (Phase 1에서 네이티브에 추가)
  - `adb logcat -s ShortsAIGuard`
- 하단 Shorts 탭 진입 → 개입 1회 / 스와이프 여러 번 → 추가 개입 없음
- 시청 선택 후 계속 시청 → 다시 안 뜸 / 나가기 → 쇼츠에서 빠져나옴 → 바로 다시 진입 → 개입 뜸
- 롱폼, 홈, 검색 → 개입 없음 / 쇼츠 → 롱폼 전환 직후 오탐 없음
- 쇼츠 중 홈 버튼·다른 앱 이동 → 세션 종료, 재진입 시 개입 재발생
- 차단 중 쇼츠 진입 → 잠금 오버레이와 남은 시간 표시
- 앱을 끈 상태에서 시청 → 다음에 앱을 열면 시간이 올바른 날짜로 기록됨

## APK 빌드와 배포 (각 Phase 완료 시 + 최종)

목표: 누구나 링크로 APK를 받아 폰에 설치할 수 있게 한다. 업로드(GitHub Releases 등)는 사용자가 직접 한다.

- 빌드 스크립트를 하나로 만든다 (예: npm run apk): npm run build → npx cap sync android → gradlew assembleRelease.
- 서명된 release APK를 만든다.
  - 키스토어(.jks)는 사용자가 직접 만든다. Claude는 keytool 명령만 안내한다.
  - 키스토어 파일과 비밀번호는 git에 넣지 않는다. android/keystore.properties(또는 환경변수)에서 읽게 하고 .gitignore에 추가한다.
  - 키스토어를 잃어버리면 같은 앱으로 업데이트 설치가 안 되므로 사용자에게 백업을 안내한다.
- 버전: 빌드할 때마다 versionCode를 올리고 versionName을 정한다 (예: 0.7.0). 앱 설정 화면에 버전을 표시한다.
- 결과 파일 이름을 정리해 release/ 폴더에 복사한다 (예: release/focuson-v0.7.0.apk).
- 릴리스 노트 초안(바뀐 점, 설치 방법)을 release/NOTES.md에 작성한다.
- README의 설치 안내를 새 APK 기준으로 고친다 (출처를 알 수 없는 앱 허용, 안드로이드 13 이상 "제한된 설정 허용", 접근성 켜기). 설정 화면(components/settings-view.tsx)의 팀원 v0.6.0 APK 링크도 함께 바꾼다.
- 패키지 이름·서명: `app.focuson.shorts`로 바꿔 팀원 앱과 별개 앱으로 결정함 (완료). 접근성 서비스 ID, settingsActivity, Capacitor 설정을 함께 고쳤다.
- 검증: 개발용 설치(adb install)가 아닌, APK 파일을 폰에서 직접 받아 설치하는 경로로 한 번 테스트한다.

## 나중에 계획서에서 고칠 부분

- 개발 기술: Kotlin/XML/MVVM/Room/WorkManager → Next.js + Capacitor + Java 서비스 + SQLite + 로컬 알림
- 사용량 측정: "사용량 API" → 접근성 서비스 기반 쇼츠 세션 측정 (사용량 API는 YouTube 전체 시간만 알 수 있음)
- AI를 향후 발전 방향에서 본 개발 범위로 (근거: JITAI, CHI 2024 Time2Stop)
