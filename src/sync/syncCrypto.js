import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/ciphers/utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SYNC_EVENT_KINDS = Object.freeze([
  "account_snapshot",
  "holding_snapshot",
  "holding_valuation",
  "ledger_event",
  "holding_operation",
  "holding_operation_correction",
  "reminder_snapshot",
]);

function concatBytes(...chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function normalizeBytes(value, expectedLength, label) {
  let bytes;
  if (value instanceof Uint8Array) {
    bytes = value;
  } else if (typeof value === "string" && value.startsWith("\\x")) {
    bytes = hexToBytes(value.slice(2));
  } else if (typeof value === "string" && /^[0-9a-f]+$/i.test(value)) {
    bytes = hexToBytes(value);
  } else {
    throw new TypeError(`${label} must be bytes or a PostgreSQL bytea hex value.`);
  }
  if (expectedLength && bytes.length !== expectedLength) {
    throw new RangeError(`${label} must contain exactly ${expectedLength} bytes.`);
  }
  return bytes;
}

function normalizeUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function normalizeTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError("occurredAt must be an ISO timestamp.");
  return timestamp.toISOString();
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError("Encrypted payload numbers must be safe integers.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError("Encrypted payload must contain JSON-safe values only.");
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function eventAad(fields) {
  return encoder.encode(canonicalStringify({
    aadVersion: 2,
    deviceId: fields.deviceId,
    eventId: fields.eventId,
    eventKind: fields.eventKind,
    idempotencyKey: fields.idempotencyKey,
    logicalClock: fields.logicalClock,
    occurredAt: fields.occurredAt,
    previousEventHash: fields.previousEventHash
      ? bytesToHex(fields.previousEventHash)
      : null,
    vaultId: fields.vaultId,
  }));
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function bytesEqual(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

export function postgresBytea(value) {
  return `\\x${bytesToHex(value)}`;
}

export async function encryptSyncEvent({
  vaultKey,
  vaultId,
  deviceId,
  eventKind,
  eventId = globalThis.crypto.randomUUID(),
  logicalClock,
  idempotencyKey,
  occurredAt = new Date().toISOString(),
  previousEventHash = null,
  payload,
}) {
  const key = normalizeBytes(vaultKey, 32, "vaultKey");
  const normalized = {
    vaultId: normalizeUuid(vaultId, "vaultId"),
    deviceId: normalizeUuid(deviceId, "deviceId"),
    eventId: normalizeUuid(eventId, "eventId"),
    eventKind: typeof eventKind === "string" ? eventKind.trim() : "",
    logicalClock,
    idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey.trim() : "",
    occurredAt: normalizeTimestamp(occurredAt),
    previousEventHash: previousEventHash
      ? normalizeBytes(previousEventHash, 32, "previousEventHash")
      : null,
  };
  if (!Number.isSafeInteger(logicalClock) || logicalClock <= 0) {
    throw new TypeError("logicalClock must be a positive safe integer.");
  }
  if (!SYNC_EVENT_KINDS.includes(normalized.eventKind)) {
    throw new TypeError("eventKind is unsupported.");
  }
  if (normalized.idempotencyKey.length < 16 || normalized.idempotencyKey.length > 160) {
    throw new TypeError("idempotencyKey must contain 16 to 160 characters.");
  }

  const nonce = randomBytes(24);
  const aad = eventAad(normalized);
  const plaintext = encoder.encode(canonicalStringify(payload));
  if (plaintext.length > 1_048_560) throw new RangeError("Encrypted event payload is too large.");
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  const eventHash = await sha256(concatBytes(aad, nonce, ciphertext));

  plaintext.fill(0);

  return Object.freeze({
    event_id: normalized.eventId,
    vault_id: normalized.vaultId,
    device_id: normalized.deviceId,
    event_kind: normalized.eventKind,
    logical_clock: normalized.logicalClock,
    idempotency_key: normalized.idempotencyKey,
    event_hash: postgresBytea(eventHash),
    previous_event_hash: normalized.previousEventHash
      ? postgresBytea(normalized.previousEventHash)
      : null,
    payload_nonce: postgresBytea(nonce),
    payload_ciphertext: postgresBytea(ciphertext),
    aad_version: 2,
    occurred_at: normalized.occurredAt,
  });
}

export async function decryptSyncEvent({ vaultKey, envelope }) {
  const key = normalizeBytes(vaultKey, 32, "vaultKey");
  const normalized = {
    vaultId: normalizeUuid(envelope?.vault_id, "vault_id"),
    deviceId: normalizeUuid(envelope?.device_id, "device_id"),
    eventId: normalizeUuid(envelope?.event_id, "event_id"),
    eventKind: envelope?.event_kind,
    logicalClock: envelope?.logical_clock,
    idempotencyKey: envelope?.idempotency_key,
    occurredAt: normalizeTimestamp(envelope?.occurred_at),
    previousEventHash: envelope?.previous_event_hash
      ? normalizeBytes(envelope.previous_event_hash, 32, "previous_event_hash")
      : null,
  };
  if (!SYNC_EVENT_KINDS.includes(normalized.eventKind)) {
    throw new Error("Unsupported encrypted event kind.");
  }
  if (envelope?.aad_version !== 2) throw new Error("Unsupported encrypted event AAD version.");
  const nonce = normalizeBytes(envelope.payload_nonce, 24, "payload_nonce");
  const ciphertext = normalizeBytes(envelope.payload_ciphertext, null, "payload_ciphertext");
  const expectedHash = normalizeBytes(envelope.event_hash, 32, "event_hash");
  const aad = eventAad(normalized);
  const actualHash = await sha256(concatBytes(aad, nonce, ciphertext));
  if (!bytesEqual(expectedHash, actualHash)) {
    throw new Error("Encrypted event hash verification failed.");
  }
  const plaintext = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  try {
    return JSON.parse(decoder.decode(plaintext));
  } finally {
    plaintext.fill(0);
  }
}
