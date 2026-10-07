// npm run apk        → 서명된 release APK (android/keystore.properties 필요)
// npm run apk:debug  → 디버그 APK (테스트용, 로그 태그 ShortsAIGuard 출력)
// 웹 빌드 → cap sync → gradle → release/shortsai-v<버전>[-debug].apk
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "debug" ? "debug" : "release";
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const android = path.join(root, "android");

if (mode === "release" && !existsSync(path.join(android, "keystore.properties"))) {
  console.error(`
android/keystore.properties 가 없어 서명된 APK를 만들 수 없습니다.

1. 키스토어를 직접 만듭니다 (비밀번호는 본인만 알게 정하세요):
   keytool -genkeypair -v -keystore android/shortsai-release.jks -alias shortsai -keyalg RSA -keysize 2048 -validity 10000

2. android/keystore.properties 를 만들고 아래처럼 적습니다 (git에 올라가지 않습니다):
   storeFile=shortsai-release.jks
   storePassword=<키스토어 비밀번호>
   keyAlias=shortsai
   keyPassword=<키 비밀번호>

3. .jks 파일과 비밀번호를 따로 백업하세요. 잃어버리면 같은 앱으로 업데이트 설치가 안 됩니다.

테스트용 디버그 APK는 npm run apk:debug 로 만들 수 있습니다.
`);
  process.exit(1);
}

function run(command, cwd = root) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

run("npm run build");
run("npx cap sync android");
const gradlew = path.join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
run(`"${gradlew}" ${mode === "release" ? "assembleRelease" : "assembleDebug"} --console=plain`, android);

const built = path.join(android, "app", "build", "outputs", "apk", mode, `app-${mode}.apk`);
if (!existsSync(built)) {
  console.error(`APK를 찾지 못했습니다: ${built}`);
  process.exit(1);
}
const outDir = path.join(root, "release");
mkdirSync(outDir, { recursive: true });
const name = `shortsai-v${version}${mode === "debug" ? "-debug" : ""}.apk`;
const dest = path.join(outDir, name);
copyFileSync(built, dest);
const sha = createHash("sha256").update(readFileSync(dest)).digest("hex").toUpperCase();
console.log(`\n완료: release/${name}`);
console.log(`크기: ${statSync(dest).size.toLocaleString("en-US")} bytes`);
console.log(`SHA-256: ${sha}`);
