import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDataRepository,
  createDataRepository,
  REQUIRED_METHODS,
} from "../src/data/repository.js";

test("demo repository fulfills the current repository contract", () => {
  const repository = createDataRepository({ dataMode: "demo" });
  assert.equal(repository.kind, "demo");
  for (const method of REQUIRED_METHODS) {
    assert.equal(typeof repository[method], "function");
  }
});

test("demo repository returns isolated serializable snapshots", () => {
  const repository = createDataRepository({ dataMode: "demo" });
  const first = repository.getSnapshot();
  const second = repository.getSnapshot();

  assert.notEqual(first, second);
  assert.notEqual(first.bankAssets, second.bankAssets);
  first.bankAssets[0].bank = "mutated";
  assert.equal(second.bankAssets[0].bank, "招商银行");
  assert.doesNotThrow(() => JSON.stringify(second));
});

test("demo data uses icon identifiers instead of React components", () => {
  const snapshot = createDataRepository({ dataMode: "demo" }).getSnapshot();
  const iconValues = [
    ...snapshot.reminderSchedule.map((item) => item.icon),
    ...snapshot.transactions.map((item) => item.icon),
    ...snapshot.insightCards.map((item) => item.icon),
  ];

  assert.ok(iconValues.every((icon) => typeof icon === "string"));
});

test("local mode requires and uses an explicit native invoke adapter", async () => {
  assert.throws(() => createDataRepository({ dataMode: "local" }), /invoke/i);
  const repository = createDataRepository(
    { dataMode: "local" },
    { invoke: async () => ({ accounts: [] }) },
  );
  assert.equal(repository.kind, "local");
  assert.deepEqual(await repository.getSnapshot(), { accounts: [] });
});

test("unsupported sync adapter fails closed instead of falling back to demo data", () => {
  assert.throws(
    () => createDataRepository({ dataMode: "sync" }),
    /not implemented yet/,
  );
});

test("repository validation rejects incomplete adapters", () => {
  assert.throws(() => assertDataRepository({}), /getSnapshot/);
});
