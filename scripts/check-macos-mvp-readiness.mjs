import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

export const MANUAL_ACCEPTANCE_CHECKS = Object.freeze([
  {
    id: "touchIdAndPassword",
    label: "Touch ID 与应用密码回退",
    hint: "登记 Touch ID，完成一次解锁，再手动锁定并使用应用密码解锁。",
  },
  {
    id: "restartUnlock",
    label: "退出、重启与同一保险库解锁",
    hint: "完全退出 Folio 后重新启动，确认先显示锁定面并能打开原保险库。",
  },
  {
    id: "realDataImportReconciliation",
    label: "代表性真实数据导入与对账",
    hint: "使用不提交仓库的真实副本，核对期初余额、导入净变化和关键持仓市值。",
  },
  {
    id: "duplicateImport",
    label: "同一文件重复导入幂等",
    hint: "再次导入同一文件，确认流水数量和余额不重复增加。",
  },
  {
    id: "backupRestore",
    label: "加密备份恢复",
    hint: "导出加密备份并恢复为新保险库，核对账户、持仓、流水和事项数量。",
  },
  {
    id: "portableExport",
    label: "可移植导出可读性与清理",
    hint: "用第三方表格工具检查 ZIP/CSV，随后安全删除本次明文测试副本。",
  },
  {
    id: "cleanInstallUpgrade",
    label: "DMG 干净安装与覆盖升级",
    hint: "完成一次干净安装和一次覆盖升级，确认原保险库不丢失。",
  },
  {
    id: "forcedQuitRecovery",
    label: "异常退出后的完整性",
    hint: "在一笔已确认写入后强制退出，重新打开并验证 SQLCipher 与最新记录完整。",
  },
]);

function versionParts(value) {
  return String(value ?? "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function versionAtLeast(actual, minimum) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function assessMacMvpReadiness({
  host,
  dmg,
  distribution,
  evidence = {},
  evidenceLoaded = false,
}) {
  const automaticChecks = [
    {
      id: "macosHost",
      label: "macOS 主机",
      ready: host.platform === "Darwin",
      detail: host.platform || "未检测到",
      hint: "Mac MVP 只能在 macOS 上构建和验收。",
    },
    {
      id: "appleSilicon",
      label: "Apple Silicon",
      ready: host.architecture === "arm64",
      detail: host.architecture || "未检测到",
      hint: "当前 MVP 安装包仅支持 arm64；Intel Mac 需要单独构建。",
    },
    {
      id: "supportedMacos",
      label: "macOS 版本",
      ready: versionAtLeast(host.version, "10.15"),
      detail: host.version || "未检测到",
      hint: "Folio 当前最低支持 macOS 10.15。",
    },
    {
      id: "verifiedDmg",
      label: "DMG 发布烟测",
      ready: Boolean(dmg.ready),
      detail: dmg.detail || "未运行",
      hint: "运行 npm run macos:verify:dmg，验证真实发布镜像。",
    },
  ];
  const manualChecks = MANUAL_ACCEPTANCE_CHECKS.map((check) => ({
    ...check,
    ready: evidence[check.id] === true,
    detail: evidence[check.id] === true ? "已记录通过" : "尚未记录",
  }));
  const automaticReady = automaticChecks.every((check) => check.ready);
  const manualReady = manualChecks.every((check) => check.ready);
  const selfUse = {
    automaticReady,
    manualReady,
    ready: automaticReady && manualReady,
    pendingManualCount: manualChecks.filter((check) => !check.ready).length,
    status: !automaticReady
      ? "automatic_gates_failed"
      : manualReady
        ? "ready"
        : "manual_acceptance_pending",
  };
  const distributionChecks = [
    {
      id: "fullXcode",
      label: "完整 Xcode",
      ready: Boolean(distribution.fullXcode),
      detail: distribution.xcodeDetail || "未检测到",
      hint: "从 App Store 安装完整 Xcode，并让 xcode-select 指向 Xcode.app。",
    },
    {
      id: "developerId",
      label: "Developer ID Application",
      ready: Boolean(distribution.developerId),
      detail: distribution.developerIdDetail || "未检测到有效身份",
      hint: "配置有效 Apple Developer ID Application 签名身份。",
    },
    {
      id: "notaryTool",
      label: "Apple notarytool",
      ready: Boolean(distribution.notaryTool),
      detail: distribution.notaryToolDetail || "未检测到",
      hint: "安装完整 Xcode，并配置公证凭据。",
    },
    {
      id: "gatekeeper",
      label: "Gatekeeper",
      ready: dmg.gatekeeper === "accepted",
      detail: dmg.gatekeeper || "未检测到",
      hint: "使用 Developer ID 签名、公证并 stapling 后重新运行严格发布门。",
    },
  ];
  const publicDistribution = {
    ready: selfUse.ready && distributionChecks.every((check) => check.ready),
    status: selfUse.ready && distributionChecks.every((check) => check.ready)
      ? "ready"
      : "not_ready",
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceLoaded,
    automaticChecks,
    manualChecks,
    distributionChecks,
    selfUse,
    publicDistribution,
  };
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
}

function firstLine(value, fallback = "未检测到") {
  return String(value ?? "").split("\n").find(Boolean) ?? fallback;
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readEvidence(path) {
  if (!existsSync(path)) return { evidence: {}, loaded: false, error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const evidence = Object.fromEntries(
      MANUAL_ACCEPTANCE_CHECKS.map(({ id }) => [id, parsed[id] === true]),
    );
    return { evidence, loaded: true, error: null };
  } catch {
    return {
      evidence: {},
      loaded: false,
      error: "验收证据文件不是有效 JSON；所有手工项目按未通过处理。",
    };
  }
}

function buildRuntimeReport() {
  const jsonOutput = process.argv.includes("--json");
  const skipDmg = process.argv.includes("--skip-dmg");
  const version = JSON.parse(
    readFileSync(resolve(projectRoot, "package.json"), "utf8"),
  ).version;
  const architectureResult = runCommand("uname", ["-m"]);
  const platformResult = runCommand("uname", ["-s"]);
  const osResult = runCommand("sw_vers", ["-productVersion"]);
  const architecture = firstLine(architectureResult.output, "unknown");
  const defaultDmg = resolve(
    projectRoot,
    `src-tauri/target/release/bundle/dmg/Folio_${version}_${architecture}.dmg`,
  );
  const dmgPath = resolve(argumentValue("--dmg") || defaultDmg);
  let dmg = {
    ready: false,
    detail: skipDmg ? "本次按参数跳过" : "尚未运行",
    gatekeeper: "unknown",
  };
  if (!skipDmg) {
    const verification = runCommand("bash", [
      "scripts/verify-macos-dmg.sh",
      dmgPath,
    ]);
    const gatekeeper = verification.output.match(/^Gatekeeper:\s*(.+)$/m)?.[1]
      ?? "unknown";
    dmg = {
      ready: verification.status === 0,
      detail: verification.status === 0
        ? `${firstLine(verification.output)} · ${dmgPath.split("/").at(-1)}`
        : firstLine(verification.output, "DMG 验证失败"),
      gatekeeper,
    };
  }

  const xcode = runCommand("xcodebuild", ["-version"]);
  const identities = runCommand("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const notaryTool = runCommand("xcrun", ["--find", "notarytool"]);
  const evidencePath = resolve(
    argumentValue("--evidence")
      || resolve(projectRoot, ".folio-mvp-acceptance.json"),
  );
  const evidenceResult = readEvidence(evidencePath);
  const report = assessMacMvpReadiness({
    host: {
      platform: firstLine(platformResult.output, "unknown"),
      architecture,
      version: firstLine(osResult.output, "unknown"),
    },
    dmg,
    distribution: {
      fullXcode: xcode.status === 0 && /^Xcode\s/m.test(xcode.output),
      xcodeDetail: firstLine(xcode.output),
      developerId: identities.status === 0
        && /Developer ID Application:/.test(identities.output),
      developerIdDetail: /0 valid identities found/.test(identities.output)
        ? "0 个有效签名身份"
        : firstLine(identities.output),
      notaryTool: notaryTool.status === 0,
      notaryToolDetail: firstLine(notaryTool.output),
    },
    evidence: evidenceResult.evidence,
    evidenceLoaded: evidenceResult.loaded,
  });
  return {
    jsonOutput,
    report: {
      ...report,
      evidenceError: evidenceResult.error,
    },
  };
}

function printHuman(report) {
  const printGroup = (title, checks) => {
    console.log(`\n${title}`);
    for (const check of checks) {
      console.log(`${check.ready ? "✓" : "✗"} ${check.label}  ${check.detail}`);
      if (!check.ready) console.log(`  → ${check.hint}`);
    }
  };
  printGroup("自动发布门", report.automaticChecks);
  printGroup("本人自用手工验收", report.manualChecks);
  printGroup("对外分发门", report.distributionChecks);
  if (report.evidenceError) console.log(`\n注意：${report.evidenceError}`);
  console.log(
    report.selfUse.ready
      ? "\n本人自用 Mac MVP：已就绪。"
      : report.selfUse.automaticReady
        ? `\n本人自用 Mac MVP：自动门已通过，仍有 ${report.selfUse.pendingManualCount} 项手工验收。`
        : "\n本人自用 Mac MVP：自动发布门尚未全部通过。",
  );
  console.log(
    report.publicDistribution.ready
      ? "对外无警告分发：已就绪。"
      : "对外无警告分发：尚未就绪，不阻塞本人内部试用。",
  );
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  const { jsonOutput, report } = buildRuntimeReport();
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (process.argv.includes("--strict-self-use") && !report.selfUse.ready) {
    process.exitCode = 1;
  }
  if (
    process.argv.includes("--strict-public")
    && !report.publicDistribution.ready
  ) {
    process.exitCode = 1;
  }
}
