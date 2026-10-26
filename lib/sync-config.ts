/**
 * 기록을 올릴 Supabase 프로젝트 (팀원 프로젝트, 팀원 hanbakja focusai 브랜치와 같은 값).
 * 공개용(publishable) 키다: 정해 둔 표에 자기 설치 번호로 넣기와 지우기만 된다 (읽기 불가).
 * service role 키·DB 비밀번호는 여기 두지 않는다. 주소나 키가 비어 있으면 올리지 않는다.
 * 나중에 Spring Boot 서버를 끼우면 이 주소만 서버로 바꾼다 (docs/server/DESIGN.md).
 */
export const SUPABASE_URL = "https://zpmkgmqqdrtuefqejtbm.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_E_1gv1tEXLxbT8OBTw8CKw_ZH0HlIzK";

export type SyncConfig = { url: string; anonKey: string };

export function bakedSyncConfig(): SyncConfig {
  return { url: SUPABASE_URL.trim(), anonKey: SUPABASE_PUBLISHABLE_KEY.trim() };
}
