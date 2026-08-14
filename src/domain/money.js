const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function assertCurrency(currency) {
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
    throw new TypeError("Currency must be a three-letter ISO 4217 code.");
  }

  return currency;
}

export function normalizeMinor(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) {
    throw new TypeError("Minor-unit amount must be an integer string or bigint.");
  }

  return BigInt(value).toString();
}

export function decimalToMinor(input, options = {}) {
  const scale = options.scale ?? 2;
  const currency = assertCurrency(options.currency ?? "CNY");

  if (!Number.isInteger(scale) || scale < 0 || scale > 8) {
    throw new RangeError("Money scale must be an integer between 0 and 8.");
  }
  if (typeof input !== "string") {
    throw new TypeError("Decimal money input must be a string to avoid float rounding.");
  }

  const normalized = input.trim().replaceAll(",", "");
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) {
    throw new TypeError(`Invalid decimal money value: ${input}`);
  }

  const [, sign = "", whole, fraction = ""] = match;
  if (fraction.length > scale) {
    throw new RangeError(
      `Money value has ${fraction.length} decimal places; ${currency} accepts ${scale}.`,
    );
  }

  const factor = 10n ** BigInt(scale);
  const paddedFraction = fraction.padEnd(scale, "0") || "0";
  const absolute = BigInt(whole) * factor + BigInt(paddedFraction);
  const amountMinor = sign === "-" ? -absolute : absolute;

  return Object.freeze({
    amountMinor: amountMinor.toString(),
    currency,
    scale,
  });
}

export function formatMinor(amountMinor, options = {}) {
  const scale = options.scale ?? 2;
  const normalized = BigInt(normalizeMinor(amountMinor));
  const negative = normalized < 0n;
  const absolute = negative ? -normalized : normalized;
  const factor = 10n ** BigInt(scale);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(scale, "0");

  return `${negative ? "-" : ""}${whole.toString()}${scale ? `.${fraction}` : ""}`;
}
