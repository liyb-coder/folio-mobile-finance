import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assessMacMvpReadiness,
  MANUAL_ACCEPTANCE_CHECKS,
  versionAtLeast,
} from "../scripts/check-macos-mvp-readiness.mjs";

const root = resolve(import.meta.dirname, "..");
const completeEvidence = Object.fromEntries(
  MANUAL_ACCEPTANCE_CHECKS.map(({ id }) => [id, true]),
);
const automaticInput = {
  host: {
    platform: "Darwin",
    architecture: "arm64",
    version: "15.5",
  },
  dmg: {
    ready: true,
    detail: "release smoke passed",
    gatekeeper: "not-notarized",
  },
  distribution: {
    fullXcode: false,
    xcodeDetail: "Command Line Tools only",
    developerId: false,
    developerIdDetail: "0 个有效签名身份",
    notaryTool: true,
    notaryToolDetail: "/usr/bin/notarytool",
  },
};

test("macOS version comparison handles minor and patch releases", () => {
  assert.equal(versionAtLeast("10.15", "10.15"), true);
  assert.equal(versionAtLeast("10.15.7", "10.15"), true);
  assert.equal(versionAtLeast("11.0", "10.15"), true);
  assert.equal(versionAtLeast("10.14.6", "10.15"), false);
});

test("automatic release gates do not pretend manual Mac acceptance is complete", () => {
  const report = assessMacMvpReadiness({
    ...automaticInput,
    evidence: {},
  });
  assert.equal(report.selfUse.automaticReady, true);
  assert.equal(report.selfUse.manualReady, false);
  assert.equal(report.selfUse.ready, false);
  assert.equal(report.selfUse.status, "manual_acceptance_pending");
  assert.equal(
    report.selfUse.pendingManualCount,
    MANUAL_ACCEPTANCE_CHECKS.length,
  );
});

test("complete local evidence makes the self-use MVP ready without public signing", () => {
  const report = assessMacMvpReadiness({
    ...automaticInput,
    evidence: completeEvidence,
    evidenceLoaded: true,
  });
  assert.equal(report.selfUse.ready, true);
  assert.equal(report.publicDistribution.ready, false);
  assert.equal(report.evidenceLoaded, true);
});

test("public distribution additionally requires Xcode, Developer ID and Gatekeeper", () => {
  const report = assessMacMvpReadiness({
    ...automaticInput,
    dmg: {
      ...automaticInput.dmg,
      gatekeeper: "accepted",
    },
    distribution: {
      fullXcode: true,
      xcodeDetail: "Xcode 16",
      developerId: true,
      developerIdDetail: "Developer ID Application",
      notaryTool: true,
      notaryToolDetail: "/usr/bin/notarytool",
    },
    evidence: completeEvidence,
  });
  assert.equal(report.selfUse.ready, true);
  assert.equal(report.publicDistribution.ready, true);
});

test("doctor exposes a portable JSON report without claiming skipped DMG evidence", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-macos-mvp-readiness.mjs", "--json", "--skip-dmg"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.selfUse.automaticReady, false);
  assert.equal(report.automaticChecks.length, 4);
  assert.equal(report.manualChecks.length, MANUAL_ACCEPTANCE_CHECKS.length);
  assert.equal(report.distributionChecks.length, 4);
});

test("manual evidence starts false and the local completion record stays out of Git", () => {
  const template = JSON.parse(
    readFileSync(
      resolve(root, ".folio-mvp-acceptance.example.json"),
      "utf8",
    ),
  );
  const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
  assert.deepEqual(
    Object.keys(template).sort(),
    MANUAL_ACCEPTANCE_CHECKS.map(({ id }) => id).sort(),
  );
  assert.ok(Object.values(template).every((value) => value === false));
  assert.match(gitignore, /^\.folio-mvp-acceptance\.json$/m);
});
