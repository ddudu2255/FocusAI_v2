/** package.json "version". APK versionName과 같다. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/**
 * APK를 올린 GitHub Releases 주소. 비워 두면 설정 화면에 링크 없이 안내만 보인다.
 * 예: "https://github.com/<아이디>/ShortsAI/releases/latest"
 */
export const RELEASES_URL = "";
