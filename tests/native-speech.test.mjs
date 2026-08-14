import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { requireNativeSpeechText } from "../src/ai/nativeSpeech.js";

const root = resolve(import.meta.dirname, "..");
const tauriConfig = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const macInfo = readFileSync(resolve(root, "src-tauri/Info.plist"), "utf8");
const iosInfo = readFileSync(resolve(root, "src-tauri/Info.ios.plist"), "utf8");
const entitlements = readFileSync(
  resolve(root, "src-tauri/Entitlements.plist"),
  "utf8",
);
const appleSpeech = readFileSync(
  resolve(root, "src-tauri/src/apple_speech.m"),
  "utf8",
);

test("native speech accepts only an explicitly on-device transcript", () => {
  assert.equal(
    requireNativeSpeechText({
      status: "transcribed",
      text: "  虚构语音流水  ",
      onDevice: true,
    }),
    "虚构语音流水",
  );
  assert.throws(
    () => requireNativeSpeechText({
      status: "transcribed",
      text: "不可信降级结果",
      onDevice: false,
    }),
    /没有返回可核对文字/,
  );
  assert.throws(
    () => requireNativeSpeechText({
      status: "on_device_unavailable",
      onDevice: false,
    }),
    /不会降级上传音频/,
  );
});

test("Apple bundles declare microphone privacy and force offline recognition", () => {
  for (const plist of [macInfo, iosInfo]) {
    assert.match(plist, /NSMicrophoneUsageDescription/);
    assert.match(plist, /NSSpeechRecognitionUsageDescription/);
    assert.match(plist, /不保存原始音频/);
  }
  assert.match(entitlements, /com\.apple\.security\.device\.audio-input/);
  assert.equal(
    tauriConfig.bundle.macOS.entitlements,
    "Entitlements.plist",
  );
  assert.match(appleSpeech, /supportsOnDeviceRecognition/);
  assert.match(appleSpeech, /requiresOnDeviceRecognition\s*=\s*YES/);
  assert.doesNotMatch(appleSpeech, /writeToFile|AVAudioFile/);
});
