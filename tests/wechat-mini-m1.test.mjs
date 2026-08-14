import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(workspaceRoot, "apps", "wechat-mini", "miniprogram");
const expectedPages = Object.freeze([
  "pages/unlock/index",
  "pages/overview/index",
  "pages/assets/index",
  "pages/cashflow/index",
  "pages/capture/index",
  "pages/reminders/index",
  "pages/assistant/index",
  "pages/settings/index",
]);

async function readSource(relativePath) {
  return readFile(path.join(sourceRoot, relativePath), "utf8");
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    if (entry.isFile()) files.push(target);
  }
  return files;
}

test("M1 registers the complete read-only product shell and centered capture tab", async () => {
  const app = JSON.parse(await readSource("app.json"));
  assert.deepEqual(app.pages, expectedPages);
  assert.equal(app.tabBar.custom, true);
  assert.deepEqual(
    app.tabBar.list.map((item) => item.pagePath),
    [
      "pages/overview/index",
      "pages/assets/index",
      "pages/capture/index",
      "pages/reminders/index",
      "pages/assistant/index",
    ],
  );

  for (const page of expectedPages) {
    const directory = path.join(sourceRoot, page);
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      const fileStat = await stat(`${directory}.${extension}`);
      assert.ok(fileStat.size > 0, `${page}.${extension} must not be empty`);
    }
  }
});

test("M1 demo fixtures are explicit, immutable and internally reconcilable", async () => {
  const fixtureSource = await readSource("data/demo-fixtures.js");
  const fixtureModule = { exports: {} };
  Function("module", "exports", fixtureSource)(fixtureModule, fixtureModule.exports);
  const fixtures = fixtureModule.exports;

  assert.equal(fixtures.fictional, true);
  assert.equal(fixtures.mode, "demo");
  assert.match(fixtures.fixtureVersion, /^wechat-m1-/);
  assert.equal(Object.isFrozen(fixtures), true);
  assert.equal(Object.isFrozen(fixtures.accounts), true);
  assert.equal(Object.isFrozen(fixtures.accounts[0]), true);
  assert.equal(
    fixtures.accounts.reduce((sum, account) => sum + account.balanceMinor, 0),
    fixtures.summary.totalAssetsMinor,
  );
  assert.ok(fixtures.reminders.every((reminder) => reminder.demo === true));
});

test("M1 display surfaces remain read-only, secret-free and visibly marked as fictional", async () => {
  const files = await walkFiles(sourceRoot);
  const textFiles = files.filter((file) =>
    /\.(?:js|json|wxml|wxss)$/.test(file)
    && !file.includes(`${path.sep}pages${path.sep}capture${path.sep}`)
    && !file.includes(`${path.sep}services${path.sep}`)
    && !file.includes(`${path.sep}config${path.sep}`),
  );
  const combined = (await Promise.all(textFiles.map((file) => readFile(file, "utf8")))).join("\n");

  assert.doesNotMatch(
    combined,
    /wx\.(?:request|uploadFile|getRecorderManager|setStorage)|ledger_(?:append|confirm)|confirm_.*draft/,
  );
  assert.doesNotMatch(
    combined,
    /(?:deepseek|openai|api)[_-]?(?:key|secret)|service[_-]?role|private[_-]?key/i,
  );
  assert.match(combined, /虚构演示/);
  assert.match(combined, /下一里程碑接入/);
});

test("M1 uses shared page chrome and packaged visual assets", async () => {
  const app = JSON.parse(await readSource("app.json"));
  const productPages = app.pages.filter((page) => !page.includes("/unlock/"));
  for (const page of productPages) {
    const config = JSON.parse(await readSource(`${page}.json`));
    assert.equal(config.usingComponents?.["folio-header"], "/components/folio-header/index");
  }

  const tabBar = await readSource("custom-tab-bar/index.wxml");
  assert.match(tabBar, /class="capture-tab/);
  assert.match(tabBar, /assets\/icons\/microphone-fill\.png/);

  for (const asset of [
    "assets/brand/folio-logo.png",
    "assets/icons/house.png",
    "assets/icons/wallet.png",
    "assets/icons/microphone-fill.png",
    "assets/icons/calendar.png",
    "assets/icons/sparkle.png",
  ]) {
    const fileStat = await stat(path.join(sourceRoot, asset));
    assert.ok(fileStat.size > 0, `${asset} must be packaged`);
  }
});

test("M1 primary pages preserve the selected Folio mobile hierarchy", async () => {
  const overview = await readSource("pages/overview/index.wxml");
  const assets = await readSource("pages/assets/index.wxml");
  const reminders = await readSource("pages/reminders/index.wxml");

  assert.match(overview, /家庭净资产/);
  assert.match(overview, /AI 今日重点/);
  assert.match(overview, /活期可用/);
  assert.match(assets, /资产配置/);
  assert.match(assets, /资产明细/);
  assert.match(reminders, /下一个重要节点/);
  assert.match(reminders, /租金管家/);
  assert.match(reminders, /保险管家/);
  assert.match(reminders, /到期管家/);
});

test("M1 packaged image references resolve inside the mini-program bundle", async () => {
  const files = await walkFiles(sourceRoot);
  const missing = [];
  for (const file of files.filter((entry) => entry.endsWith(".wxml"))) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/src="(\/[^"]+)"/g)) {
      try {
        await stat(path.join(sourceRoot, match[1]));
      } catch {
        missing.push({ file: path.relative(sourceRoot, file), asset: match[1] });
      }
    }
  }
  assert.deepEqual(missing, []);
});
