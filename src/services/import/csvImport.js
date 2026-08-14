import { decimalToMinor } from "../../domain/money.js";

const TYPE_SIGN = Object.freeze({
  income: 1n,
  expense: -1n,
  transfer_in: 1n,
  transfer_out: -1n,
  adjustment: 1n,
});

function parseDelimitedText(tableText, delimiter, label) {
  if (typeof tableText !== "string") {
    throw new TypeError(`${label} content must be text.`);
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const text = tableText.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === delimiter && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error(`${label} contains an unterminated quoted field.`);
  }
  row.push(field);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

export function parseCsv(csvText) {
  return parseDelimitedText(csvText, ",", "CSV");
}

export function parseTsv(tsvText) {
  return parseDelimitedText(tsvText, "\t", "TSV");
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requiredColumn(columnMap, key) {
  const name = columnMap[key];
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError(`columnMap.${key} is required.`);
  }
  return name.trim();
}

export async function buildTransactionImportDraft(options) {
  const {
    csvText,
    columnMap,
    vaultId,
    sourceId,
    parserVersion = "csv-v1",
    defaultCurrency = "CNY",
  } = options;
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("CSV must contain a header and at least one data row.");
  }

  const headers = rows[0].map((header) => header.trim());
  const indexes = Object.fromEntries(
    ["date", "account", "amount", "type"].map((key) => {
      const column = requiredColumn(columnMap, key);
      const index = headers.indexOf(column);
      if (index === -1) {
        throw new Error(`CSV column "${column}" was not found.`);
      }
      return [key, index];
    }),
  );
  indexes.currency = columnMap.currency
    ? headers.indexOf(columnMap.currency)
    : -1;
  indexes.description = columnMap.description
    ? headers.indexOf(columnMap.description)
    : -1;
  indexes.externalId = columnMap.externalId
    ? headers.indexOf(columnMap.externalId)
    : -1;

  const sourceFingerprint = await sha256Hex(
    `${parserVersion}\n${sourceId}\n${csvText}`,
  );
  const proposedEvents = [];
  const errors = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const displayRow = rowIndex + 2;
    try {
      const type = row[indexes.type]?.trim();
      const sign = TYPE_SIGN[type];
      if (!sign) {
        throw new Error(`Unsupported transaction type "${type}".`);
      }

      const currency = indexes.currency >= 0
        ? row[indexes.currency]?.trim() || defaultCurrency
        : defaultCurrency;
      const parsedMoney = decimalToMinor(row[indexes.amount]?.trim(), { currency });
      const absoluteMinor = BigInt(parsedMoney.amountMinor);
      const signedMinor = (
        sign < 0n ? -BigInt(absoluteMinor < 0n ? -absoluteMinor : absoluteMinor) : absoluteMinor
      ).toString();
      const occurredAt = new Date(row[indexes.date]?.trim());
      if (Number.isNaN(occurredAt.getTime())) {
        throw new Error("Invalid transaction date.");
      }

      const externalId = indexes.externalId >= 0
        ? row[indexes.externalId]?.trim()
        : "";
      proposedEvents.push({
        id: externalId || `row-${displayRow}`,
        confidence: 1,
        evidence: [{ source: sourceId, row: displayRow }],
        event: {
          vaultId,
          accountId: row[indexes.account]?.trim(),
          eventType: type,
          deltaMinor: signedMinor,
          currency,
          occurredAt: occurredAt.toISOString(),
          status: "confirmed",
          metadata: {
            description: indexes.description >= 0
              ? row[indexes.description]?.trim()
              : "",
            sourceId,
            sourceFingerprint,
            sourceRow: displayRow,
            parserVersion,
          },
        },
      });
    } catch (error) {
      errors.push({
        row: displayRow,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    source: `csv:${sourceId}`,
    sourceFingerprint,
    parserVersion,
    proposedEvents,
    errors,
    rowCount: rows.length - 1,
  };
}
