import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalToMinor,
  formatMinor,
  normalizeMinor,
} from "../src/domain/money.js";

test("money conversion uses exact integer minor units", () => {
  assert.deepEqual(decimalToMinor("12,800.05"), {
    amountMinor: "1280005",
    currency: "CNY",
    scale: 2,
  });
  assert.equal(formatMinor("-1280005"), "-12800.05");
  assert.equal(normalizeMinor(900719925474099312345n), "900719925474099312345");
});

test("money conversion rejects floats and excessive precision", () => {
  assert.throws(() => decimalToMinor(0.1), /must be a string/);
  assert.throws(() => decimalToMinor("1.001"), /decimal places/);
  assert.throws(() => decimalToMinor("NaN"), /Invalid decimal/);
});
