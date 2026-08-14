import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const miniRoot = path.join(workspaceRoot, "apps", "wechat-mini");
const sourceRoot = path.join(miniRoot, "miniprogram");

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

test("native WeChat shell has a reviewable tourist-mode project baseline", async () => {
  const project = JSON.parse(await readFile(path.join(miniRoot, "project.config.json"), "utf8"));
  const app = JSON.parse(await readFile(path.join(sourceRoot, "app.json"), "utf8"));

  assert.equal(project.compileType, "miniprogram");
  assert.equal(project.miniprogramRoot, "miniprogram/");
  assert.equal(project.appid, "touristappid");
  assert.equal(project.setting.es6, true);
  assert.equal(project.setting.minified, true);
  assert.ok(app.pages.includes("pages/overview/index"));
  assert.ok(app.pages.includes("pages/capture/index"));
  assert.equal(app.permission?.["scope.record"], undefined);
});

test("native WeChat shell is dependency-free, secret-free and below the M0 source budget", async () => {
  const files = await walkFiles(miniRoot);
  const sourceFiles = files.filter((file) => /\.(?:js|json|wxml|wxss|md)$/.test(file));
  let totalBytes = 0;
  let combined = "";

  for (const file of sourceFiles) {
    const fileStat = await stat(file);
    totalBytes += fileStat.size;
    combined += `\n${await readFile(file, "utf8")}`;
  }

  assert.equal(files.some((file) => file.endsWith("package.json")), false);
  assert.equal(/<web-view\b/i.test(combined), false);
  assert.equal(/(?:api[_-]?key|app[_-]?secret|service[_-]?role|private[_-]?key)/i.test(combined), false);
  assert.ok(totalBytes < 200_000, `M0 source is unexpectedly large: ${totalBytes} bytes`);
});

test("native WeChat shell proves Canvas support without representing fixture money as real data", async () => {
  const pageWxml = await readFile(
    path.join(sourceRoot, "pages", "index", "index.wxml"),
    "utf8",
  );
  const pageJs = await readFile(
    path.join(sourceRoot, "pages", "index", "index.js"),
    "utf8",
  );

  assert.match(pageWxml, /<canvas[^>]+type="2d"[^>]+id="contractCanvas"/);
  assert.match(pageJs, /createSelectorQuery/);
  assert.match(pageWxml, /架构验证/);
  assert.doesNotMatch(pageWxml, /[￥¥$]\s*\d|\d[\d,.]*\s*元/);
});
