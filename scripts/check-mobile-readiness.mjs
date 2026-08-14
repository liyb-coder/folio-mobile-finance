import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");
const rustupPath = existsSync(join(homedir(), ".cargo", "bin", "rustup"))
  ? join(homedir(), ".cargo", "bin", "rustup")
  : "rustup";
const requiredRustTargets = Object.freeze([
  "aarch64-apple-ios",
  "aarch64-apple-ios-sim",
  "x86_64-apple-ios",
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android",
]);

function commandCheck(label, command, args, hint) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return {
    label,
    ready: result.status === 0,
    detail: output.split("\n").find(Boolean) ?? "未检测到",
    hint,
  };
}

function versionDirectories(root, child) {
  const directory = join(root, child);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function androidSdkCheck() {
  const root = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  if (!root || !existsSync(root)) {
    return {
      label: "Android SDK 组件",
      ready: false,
      detail: "ANDROID_HOME / ANDROID_SDK_ROOT 未配置",
      hint: "在 Android Studio 安装 SDK 后配置 ANDROID_HOME，并重新打开终端。",
    };
  }
  const missing = [
    ["platforms", "Android SDK Platform", true],
    ["platform-tools", "Platform Tools", false],
    ["build-tools", "Build Tools", true],
    ["cmdline-tools", "Command-line Tools", true],
    ["ndk", "NDK (Side by side)", true],
  ].filter(([child, , versioned]) => (
    versioned
      ? versionDirectories(root, child).length === 0
      : !existsSync(join(root, child))
  ));
  return {
    label: "Android SDK 组件",
    ready: missing.length === 0,
    detail: missing.length === 0
      ? root
      : `缺少 ${missing.map(([, name]) => name).join("、")}`,
    hint: "在 Android Studio SDK Manager 安装 Platform、Platform Tools、Build Tools、Command-line Tools 和 NDK。",
  };
}

function rustTargetsCheck() {
  const result = spawnSync(rustupPath, ["target", "list", "--installed"], {
    encoding: "utf8",
    env: process.env,
  });
  const installed = new Set(
    (result.stdout ?? "").split(/\s+/).filter(Boolean),
  );
  const missing = requiredRustTargets.filter((target) => !installed.has(target));
  return {
    label: "Rust 移动 targets",
    ready: result.status === 0 && missing.length === 0,
    detail: result.status !== 0
      ? "无法读取已安装 targets"
      : missing.length === 0
        ? `已安装 ${requiredRustTargets.length} 个必需 target`
        : `缺少 ${missing.join("、")}`,
    hint: `运行 rustup target add ${requiredRustTargets.join(" ")}`,
  };
}

const checks = [
  commandCheck(
    "完整 Xcode",
    "xcodebuild",
    ["-version"],
    "从 App Store 安装完整 Xcode，首次启动接受许可并安装组件。",
  ),
  commandCheck(
    "iPhoneOS SDK",
    "xcrun",
    ["--sdk", "iphoneos", "--show-sdk-path"],
    "安装完整 Xcode 后确认 xcode-select 指向 Xcode.app。",
  ),
  commandCheck(
    "iPhoneSimulator SDK",
    "xcrun",
    ["--sdk", "iphonesimulator", "--show-sdk-path"],
    "在 Xcode Settings > Platforms 安装至少一个 iOS Simulator runtime。",
  ),
  commandCheck(
    "CocoaPods",
    "pod",
    ["--version"],
    "安装 CocoaPods，用于生成和维护 Tauri iOS 原生工程依赖。",
  ),
  commandCheck(
    "Java / JDK",
    "javac",
    ["-version"],
    "使用 Android Studio 内置 JBR，并配置 JAVA_HOME。",
  ),
  androidSdkCheck(),
  commandCheck(
    "Android SDK Manager",
    "sdkmanager",
    ["--version"],
    "将 Android SDK Command-line Tools 的 bin 目录加入 PATH。",
  ),
  commandCheck(
    "Android Debug Bridge",
    "adb",
    ["version"],
    "通过 Android Studio 安装 Android SDK Platform Tools 并加入 PATH。",
  ),
  rustTargetsCheck(),
];

const ready = checks.every((item) => item.ready);

if (jsonOutput) {
  console.log(JSON.stringify({
    ready,
    requiredRustTargets,
    checks,
  }, null, 2));
} else {
  const width = Math.max(...checks.map((item) => item.label.length));
  for (const item of checks) {
    const mark = item.ready ? "✓" : "✗";
    console.log(`${mark} ${item.label.padEnd(width)}  ${item.detail}`);
    if (!item.ready) console.log(`  → ${item.hint}`);
  }
  console.log(
    ready
      ? "\n移动端构建依赖已就绪，可以初始化 iOS/Android 工程。"
      : "\n移动端构建依赖尚未齐全；Folio macOS 与共享前端不受影响。",
  );
}

if (strict && !ready) process.exitCode = 1;
