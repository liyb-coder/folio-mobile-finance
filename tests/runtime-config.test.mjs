import assert from "node:assert/strict";
import test from "node:test";
import { DATA_MODES, readRuntimeConfig } from "../src/config/runtime.js";

test("runtime config defaults to a locked web surface", () => {
  const config = readRuntimeConfig({});
  assert.equal(config.dataMode, "locked");
  assert.equal(config.publicDemoEnabled, false);
  assert.deepEqual(DATA_MODES, ["locked", "demo", "local", "sync"]);
});

test("runtime config rejects unknown data modes", () => {
  assert.throws(
    () => readRuntimeConfig({ VITE_DATA_MODE: "production" }),
    /Unsupported VITE_DATA_MODE/,
  );
});

test("public demo requires an explicit non-secret feature flag", () => {
  assert.throws(
    () => readRuntimeConfig({ VITE_DATA_MODE: "demo" }),
    /VITE_PUBLIC_DEMO_ENABLED=true/,
  );
  const config = readRuntimeConfig({
    VITE_DATA_MODE: "demo",
    VITE_PUBLIC_DEMO_ENABLED: "true",
  });
  assert.equal(config.dataMode, "demo");
  assert.equal(config.publicDemoEnabled, true);
});

test("sync mode requires public Supabase connection values", () => {
  assert.throws(
    () => readRuntimeConfig({ VITE_DATA_MODE: "sync" }),
    /Sync mode requires/,
  );

  const config = readRuntimeConfig({
    VITE_DATA_MODE: "sync",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-value",
  });

  assert.equal(config.dataMode, "sync");
  assert.equal(config.supabaseUrl, "https://example.supabase.co");
});
