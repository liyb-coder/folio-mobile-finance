import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidates() {
  const explicit = [process.env.FOLIO_CODEX_PATH, process.env.CODEX_CLI_PATH].filter(Boolean);
  const fromPath = String(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, "codex"));
  return [
    ...explicit,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    ...fromPath,
    join(homedir(), ".local/bin/codex"),
    join(homedir(), ".npm-global/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 12_000,
    shell: false,
    env: {
      HOME: process.env.HOME,
      CODEX_HOME: process.env.CODEX_HOME,
      PATH: process.env.PATH,
      LANG: process.env.LANG ?? "en_US.UTF-8",
    },
  });
  return {
    ok: result.status === 0,
    text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
}

const cliPath = candidates().find(executable) ?? null;
const version = cliPath ? run(cliPath, ["--version"]) : { ok: false, text: "" };
const auth = cliPath ? run(cliPath, ["login", "status"]) : { ok: false, text: "" };
const authenticated = auth.ok && auth.text.includes("Logged in");
const appCandidates = [
  join(projectRoot, "src-tauri/target/release/bundle/macos/Folio.app"),
  "/Applications/Folio.app",
  join(homedir(), "Applications/Folio.app"),
];
const appPath = appCandidates.find(existsSync) ?? null;
const dmgDirectory = join(projectRoot, "src-tauri/target/release/bundle/dmg");
const dmgNames = existsSync(dmgDirectory)
  ? readdirSync(dmgDirectory).filter((name) => /^Folio_.+\.dmg$/.test(name)).sort()
  : [];
const report = {
  ready: Boolean(cliPath && version.ok && authenticated && appPath && dmgNames.length),
  codexCli: {
    path: cliPath,
    version: version.ok ? version.text.split("\n")[0] : null,
    authenticated,
  },
  desktopPackage: {
    appPath,
    dmgPath: dmgNames.length ? join(dmgDirectory, dmgNames.at(-1)) : null,
    needsDevServer: false,
  },
  manualChecks: [
    "在客户现场网络上先完成一次虚构文本解析",
    "确认 macOS 已授予 Folio 麦克风与语音识别权限",
    "只使用虚构或客户明确授权的数据进行展示",
  ],
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write([
    `Customer demo: ${report.ready ? "READY" : "NOT READY"}`,
    `Codex CLI: ${report.codexCli.version ?? "not found"}`,
    `ChatGPT login: ${authenticated ? "ready" : "not ready"}`,
    `Standalone app: ${report.desktopPackage.appPath ?? "not built"}`,
    `DMG: ${report.desktopPackage.dmgPath ?? "not built"}`,
    "DEV server: not required by the packaged app",
    ...report.manualChecks.map((item) => `Manual: ${item}`),
    "",
  ].join("\n"));
}

process.exitCode = report.ready ? 0 : 1;
