import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "src/NativeVaultApp.jsx"), "utf8");
const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
const voiceWave = readFileSync(resolve(root, "src/components/assistant/VoiceWaveCanvas.jsx"), "utf8");
const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const doctor = readFileSync(resolve(root, "scripts/check-mobile-readiness.mjs"), "utf8");
const viteConfig = readFileSync(resolve(root, "vite.config.mjs"), "utf8");

test("native workspace has a persistent mobile nav with the voice action in the center slot", () => {
  assert.match(app, /className="local-mobile-nav"/);
  assert.match(app, /localNavItems\.slice\(0,\s*2\)/);
  assert.match(app, /className="local-mobile-voice"/);
  assert.match(app, /item\.id === "reminders" \|\| item\.id === "assistant"/);
  assert.doesNotMatch(app, /active === "assistant" \?/);
  assert.doesNotMatch(app, /local-mobile-voice-spacer/);
  assert.match(styles, /\.local-mobile-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(5/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
});

test("mobile AI capture is one concise hub for voice, documents, and text", () => {
  assert.match(app, /aria-label="打开 AI 录入"/);
  assert.match(app, /<span>记一笔<\/span>/);
  assert.match(app, /role="tablist" aria-label="选择录入方式"/);
  assert.match(app, /<b>语音<\/b>/);
  assert.match(app, /browserTextOnly \? "Markdown \/ 文本" : "截图 \/ 文档"/);
  assert.match(app, /<b>文字<\/b>/);
  assert.match(app, /图片 \/ PDF \/ Markdown \/ 文本/);
  assert.match(app, /截图与 PDF 的设备内 OCR 请在 macOS App 中测试/);
  assert.doesNotMatch(app, /先核对，再写入/);
  assert.match(app, /<VoiceWaveCanvas active=\{listening\} level=\{speechLevel\}/);
  assert.match(app, /核对本次语音稿/);
  assert.match(app, /核对已整理的语音稿/);
  assert.match(app, /organizeVoiceReview/);
  assert.match(app, /splitVoiceReviewItems/);
  assert.match(app, /proposalQueue/);
  assert.match(app, /明确确认并继续下一项/);
  assert.match(app, /结束并核对/);
  assert.match(app, /onStopSpeechCapture/);
  assert.match(styles, /\.local-ai-mic-orb\.is-stop/);
  assert.doesNotMatch(app, /className="local-ai-privacy-line"/);
  assert.match(styles, /\.local-ai-voice-stage\s*\{[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
  assert.match(app, /confirmedByUser: true/);
  assert.match(voiceWave, /requestAnimationFrame/);
  assert.match(voiceWave, /prefers-reduced-motion/);
  assert.doesNotMatch(app, /仅本次使用设备内语音/);
  assert.doesNotMatch(app, /local-ai-codex-status/);
  assert.doesNotMatch(app, /local-onboarding-steps/);
});

test("empty mobile workspace preserves the Folio V2 dashboard rhythm while adding AI cold start", () => {
  assert.match(app, /把资料交给 Folio/);
  assert.match(app, /onCapture\("voice"\)/);
  assert.match(app, /onCapture\("file"\)/);
  assert.match(app, /className="net-worth-card"/);
  assert.match(app, /className="ai-focus-card"/);
  assert.match(app, /className="metrics-row"/);
  assert.match(app, /家庭净资产/);
  assert.match(app, /AI 今日重点/);
});

test("asset cash filter uses account-internal cash holdings and excludes frozen funds", () => {
  assert.match(app, /holdingTypesByAssetCategory/);
  assert.match(app, /cash:\s*\["cash_management"\]/);
  assert.match(app, /活期合计|\{assetCategoryFilters\.find/);
  assert.match(app, /不含冻结资金/);
  assert.match(app, /项可用现金资产/);
});

test("mobile drawer keeps every module reachable outside the five primary tabs", () => {
  assert.match(app, /aria-label="打开全部模块"/);
  assert.match(app, /localNavItems\.map\(\(item\)/);
  assert.match(styles, /\.local-sidebar\.mobile-open\s*\{[\s\S]*translateX\(0\)/);
  assert.match(styles, /\.local-mobile-scrim/);
});

test("desktop workspace exposes an explicit top-right lock control", () => {
  assert.match(app, /className="local-top-actions"[\s\S]{0,700}className="local-top-lock-button"/);
  assert.match(app, /aria-label="暂时锁定 Folio"/);
  assert.match(app, /隐藏资产信息，回来后验证身份继续/);
  assert.match(app, /但不会删除任何数据；解锁后会回到刚才的模块/);
  assert.match(app, /initialView=\{resumeView\}/);
  assert.match(app, /onViewChange=\{setResumeView\}/);
  assert.match(app, /!DEFAULT_AUTOMATIC_LOCK_ENABLED[\s\S]{0,160}phase !== "workspace"/);
  assert.match(app, /!DEFAULT_AUTOMATIC_LOCK_ENABLED[\s\S]{0,160}document\.visibilityState !== "hidden"/);
  assert.match(styles, /\.local-topbar \.local-top-lock-button/);
});

test("desktop pet uses approved raster states, stays anchored, and stays compact on mobile", () => {
  assert.match(app, /function FolioDeskPet/);
  assert.match(app, /placement="assistant"/);
  assert.match(app, /companion=\{\(/);
  assert.match(styles, /folio-cat-welcome-static-transparent\.png/);
  assert.match(styles, /folio-cat-rest-grooming-static-transparent\.png/);
  assert.match(styles, /folio-cat-idle-transparent\.png/);
  assert.match(styles, /folio-cat-processing-transparent\.png/);
  assert.match(styles, /folio-cat-ready-transparent\.png/);
  assert.match(styles, /folio-cat-needs-input-transparent\.png/);
  assert.match(styles, /folio-cat-done-transparent\.png/);
  assert.match(styles, /folio-cat-welcome-transparent\.webp/);
  assert.match(styles, /\.folio-desk-pet\.state-idle[\s\S]{0,240}right:\s*252px/);
  assert.match(styles, /\.folio-desk-pet\.state-idle[\s\S]{0,280}bottom:\s*75px/);
  assert.match(styles, /\.folio-desk-pet\.state-idle \.folio-pet-frame\s*\{[\s\S]*width:\s*54px[\s\S]*height:\s*72px/);
  assert.match(styles, /\.folio-desk-pet\.state-idle \.folio-pet-frame\s*\{[\s\S]*top:\s*-14px/);
  assert.match(styles, /\.folio-desk-pet\.state-idle \.folio-pet-frame\s*\{[\s\S]*background-position:\s*center top/);
  assert.match(styles, /\.folio-desk-pet\.state-idle \.folio-pet-frame\s*\{[\s\S]*background-size:\s*72px 72px/);
  assert.match(styles, /\.folio-desk-pet\.state-idle \.folio-pet-frame\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(styles, /\.folio-desk-pet\.state-idle[\s\S]{0,280}z-index:\s*14/);
  assert.doesNotMatch(styles, /\.folio-desk-pet\.state-idle[\s\S]{0,240}right:\s*272px/);
  assert.match(styles, /\.folio-desk-pet:not\(\.state-welcome\)::after/);
  assert.match(styles, /\.folio-desk-pet\.state-ready[\s\S]{0,180}z-index:\s*17/);
  assert.match(styles, /will-change:\s*transform, opacity/);
  assert.match(app, /rest: \["猫猫睡着了", "需要时轻轻叫醒 Folio"\]/);
  assert.match(app, /className="folio-pet-zzz"/);
  assert.match(app, /event\?\.target\?\.closest\?\.\("\.folio-desk-pet"\)/);
  assert.match(app, /onOpenInbox=\{\(\) => \{[\s\S]{0,100}setPetState\("idle"\)/);
  assert.match(styles, /\.folio-desk-pet\.state-rest \.folio-pet-frame\s*\{[\s\S]*animation:\s*none/);
  assert.match(styles, /\.folio-desk-pet\.state-rest \.folio-pet-frame\s*\{[\s\S]*width:\s*88px[\s\S]*height:\s*78px/);
  assert.match(styles, /\.folio-desk-pet\.state-rest \.folio-pet-frame\s*\{[\s\S]*background-size:\s*92px 92px/);
  assert.match(styles, /\.folio-desk-pet\.state-rest\s*\{[\s\S]*right:\s*193px[\s\S]*min-width:\s*92px[\s\S]*min-height:\s*90px/);
  assert.match(styles, /folio-pet-zzz 3\.6s/);
  assert.match(app, /45_000/);
  assert.match(styles, /\.folio-desk-pet\.state-rest/);
  assert.match(styles, /\.folio-desk-pet\.state-processing/);
  assert.match(styles, /\.folio-desk-pet\.state-ready/);
  assert.match(styles, /\.folio-desk-pet\.state-needs_input/);
  assert.match(viteConfig, /assets\/pet\/folio-cat-rest-grooming-static-transparent\.png/);
  assert.match(viteConfig, /assets\/pet\/folio-cat-rest-grooming-transparent\.webp/);
  assert.match(viteConfig, /assets\/pet\/folio-cat-welcome-transparent\.webp/);
  assert.match(viteConfig, /assets\/pet\/folio-cat-welcome-static-transparent\.png/);
  assert.match(styles, /@media \(max-width: 840px\)[\s\S]*\.folio-desk-pet\s*\{[\s\S]*display:\s*none/);
});

test("overview and cashflow use only confirmed records for analytical modules", () => {
  assert.match(app, />\u8d44\u4ea7\u8d8b\u52bf</);
  assert.match(app, />\u8d44\u4ea7\u914d\u7f6e</);
  assert.match(app, />\u6536\u652f\u53d8\u5316</);
  assert.match(app, /localMonthlyCashflowSeries\(transactions, baseCurrency, now\)/);
  assert.doesNotMatch(app, /analyticsPreview/);
  assert.doesNotMatch(app, /const assetTrend = \[\];/);
  assert.match(app, /deriveConfirmedAssetTrend/);
  assert.match(app, /deriveAssetTrendYAxisDomain\(assetTrend\)/);
  assert.match(app, /allowDataOverflow/);
  assert.doesNotMatch(app, /const assetTrendDomain = \[0,/);
  assert.match(app, /已确认账本 · 区间缩放/);
  assert.match(styles, /\.local-overview-insights/);
  assert.match(styles, /\.local-cashflow-chart-card/);
});

test("AI inbox is persistent, review-only, and opened by the desktop pet", () => {
  assert.match(app, /AI 待核对收件箱/);
  assert.match(app, /只有明确确认才会影响正式数据/);
  assert.match(app, /onRefreshAiInbox/);
  assert.match(app, /pendingCount=\{aiInbox\.filter/);
  assert.match(app, /待核对收件箱/);
  assert.match(app, /aiInboxCount/);
  assert.doesNotMatch(app, /AI 待核对收件箱[\s\S]{0,800}自动确认/);
});

test("Tauri mobile entrypoint and repeatable platform commands are declared", () => {
  assert.match(rust, /cfg_attr\(mobile,\s*tauri::mobile_entry_point\)/);
  assert.equal(packageJson.scripts["tauri:ios:init"], "tauri ios init");
  assert.equal(packageJson.scripts["tauri:ios:dev"], "tauri ios dev");
  assert.equal(packageJson.scripts["tauri:ios:build"], "tauri ios build");
  assert.equal(packageJson.scripts["tauri:android:init"], "tauri android init");
  assert.match(packageJson.scripts["mobile:doctor"], /check-mobile-readiness/);
  assert.match(doctor, /aarch64-apple-ios-sim/);
  assert.match(doctor, /x86_64-apple-ios/);
  assert.match(doctor, /aarch64-linux-android/);
  assert.match(doctor, /x86_64-linux-android/);
  assert.match(doctor, /iPhoneSimulator SDK/);
  assert.match(doctor, /CocoaPods/);
  assert.match(doctor, /Android SDK 组件/);
});
