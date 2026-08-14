import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageScript = readFileSync(resolve(root, "scripts/package-macos-dmg.sh"), "utf8");
const verifyScript = readFileSync(resolve(root, "scripts/verify-macos-dmg.sh"), "utf8");

test("macOS packaging always runs the mounted-image release verifier", () => {
  assert.equal(
    packageJson.scripts["macos:verify:dmg"],
    "bash scripts/verify-macos-dmg.sh",
  );
  assert.equal(
    packageJson.scripts["macos:mvp:doctor"],
    "node scripts/check-macos-mvp-readiness.mjs",
  );
  assert.match(packageScript, /verify-macos-dmg\.sh/);
  assert.match(verifyScript, /hdiutil verify/);
  assert.match(verifyScript, /hdiutil attach[\s\S]*-readonly[\s\S]*-nobrowse/);
  assert.match(verifyScript, /hdiutil detach/);
});

test("macOS release verifier enforces app identity, architecture and privacy metadata", () => {
  assert.match(verifyScript, /com\.beizi\.folio/);
  assert.match(verifyScript, /CFBundleShortVersionString/);
  assert.match(verifyScript, /LSMinimumSystemVersion/);
  assert.match(verifyScript, /NSMicrophoneUsageDescription/);
  assert.match(verifyScript, /NSSpeechRecognitionUsageDescription/);
  assert.match(verifyScript, /lipo -archs/);
  assert.match(verifyScript, /codesign --verify --deep --strict/);
  assert.match(verifyScript, /entitlements_path/);
  assert.match(verifyScript, /audio-input/);
});

test("macOS release verifier rejects bundled private runtime artifacts", () => {
  for (const pattern of [
    String.raw`\*\.db`,
    String.raw`\*\.sqlite`,
    String.raw`\*\.folio-backup`,
    String.raw`\*\.folio-export`,
    String.raw`\*\.csv`,
    String.raw`\*\.xlsx`,
  ]) {
    assert.match(verifyScript, new RegExp(pattern));
  }
  assert.match(verifyScript, /unexpected top-level entries/);
  assert.match(verifyScript, /\/Users\/\|\/private\/tmp\/\|\/var\/folders\//);
});

test("notarization can be promoted from an advisory to a hard release gate", () => {
  assert.match(verifyScript, /FOLIO_REQUIRE_NOTARIZED/);
  assert.match(verifyScript, /spctl --assess --type execute/);
  assert.match(verifyScript, /Signature=adhoc/);
  assert.match(verifyScript, /Gatekeeper: \$\{gatekeeper_status\}/);
});
