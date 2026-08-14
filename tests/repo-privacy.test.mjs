import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolutePath = join(directory, name);
    return statSync(absolutePath).isDirectory()
      ? walk(absolutePath)
      : [absolutePath];
  });
}

test("private runtime files are ignored by Git", () => {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  const rules = new Set(
    gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const requiredRules = [
    ".env",
    ".env.*",
    "!.env.example",
    "private-data/",
    "imports/private/",
    "backups/",
    "exports/private/",
    "*.folio-backup",
    "*.folio-export.zip",
    "*.local.db",
    "*.local.sqlite",
    "*.local.sqlite3",
    "*.local.sqlite3-*",
    "*.p12",
    "*.keystore",
  ];

  for (const rule of requiredRules) {
    assert.ok(rules.has(rule), `.gitignore is missing required rule: ${rule}`);
  }
});

test("the public environment template contains no secret fields", () => {
  const template = readFileSync(join(root, ".env.example"), "utf8");
  const assignments = template
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"));

  assert.match(template, /VITE_DATA_MODE=demo/);
  assert.match(template, /VITE_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(
    assignments.join("\n"),
    /(SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY|PASSWORD|RECOVERY_KEY)\s*=/i,
  );
});

test("frontend source contains no privileged credential names or live keys", () => {
  const sourceFiles = [
    ...walk(join(root, "src")),
    ...walk(join(root, "src-tauri")),
    ...walk(join(root, "db")),
  ].filter((path) =>
    /\.(?:js|jsx|ts|tsx|css|html|m|rs|toml|json|sql)$/.test(path),
  );
  const forbidden = [
    /\bSUPABASE_SERVICE_ROLE(?:_KEY)?\b/i,
    /\bSUPABASE_SECRET_KEY\b/i,
    /\bservice_role\s*[:=]/i,
    /\bsk-(?:proj|live)-[A-Za-z0-9_-]{16,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];

  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relative(root, path)} contains a forbidden credential pattern.`,
      );
    }
  }
});
