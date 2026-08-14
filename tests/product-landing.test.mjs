import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the public product route is isolated from the locked finance application", async () => {
  const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(source, /window\.location\.pathname === "\/product"/);
  assert.match(source, /folio-private-finance\.liyubei1212\.chatgpt\.site/);
  assert.match(source, /isOfficialProductHost && window\.location\.pathname === "\/"/);
  assert.match(source, /!isTauri\(\)/);
  assert.match(source, /<ProductLanding \/>/);
});

test("the product page communicates the privacy and review boundaries", async () => {
  const source = await readFile(new URL("../src/ProductLanding.jsx", import.meta.url), "utf8");
  assert.match(source, /你的财务，/);
  assert.match(source, /本地加密数据/);
  assert.match(source, /解析/);
  assert.match(source, /核对/);
  assert.match(source, /确认/);
  assert.match(source, /虚构演示数据/);
  assert.doesNotMatch(source, /立即下载/);
});

test("production builds publish only runtime assets, not design source archives", async () => {
  const source = await readFile(new URL("../vite.config.mjs", import.meta.url), "utf8");
  assert.match(source, /publicDir: command === "serve" \? "public" : false/);
  assert.match(source, /folio-logo\.png/);
  assert.match(source, /folio-cat-avatar\.png/);
  assert.match(source, /folio-transaction-import-template\.csv/);
  assert.match(source, /og\.png/);
  assert.doesNotMatch(source, /brand-exploration/);
  assert.doesNotMatch(source, /assets\/qa/);
});
