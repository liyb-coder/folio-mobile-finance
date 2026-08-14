const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = Object.freeze(["csv", "tsv", "xlsx"]);

function extensionOf(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  const separator = normalized.lastIndexOf(".");
  return separator >= 0 ? normalized.slice(separator + 1) : "";
}

export function validateImportFileMeta(file) {
  if (!file || typeof file.name !== "string") {
    return "请选择一个 CSV、TSV 或 XLSX 文件。";
  }
  if (!SUPPORTED_EXTENSIONS.includes(extensionOf(file.name))) {
    return "仅支持 .csv、.tsv 和 .xlsx 文件。";
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return "导入文件不能为空。";
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return "单个导入文件不能超过 10 MB。";
  }
  return "";
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export async function readImportFile(file) {
  const issue = validateImportFileMeta(file);
  if (issue) throw new Error(issue);
  return {
    fileName: file.name,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
  };
}

export function createCsvTextPayload(text, fileName = "粘贴流水.csv") {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("请粘贴包含表头和数据行的 CSV 内容。");
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("CSV 内容不能超过 10 MB。");
  }
  return {
    fileName,
    contentBase64: arrayBufferToBase64(bytes.buffer),
  };
}

export function createPastedTablePayload(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("请粘贴包含表头和数据行的表格内容。");
  }
  const format = text.includes("\t") ? "tsv" : "csv";
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("粘贴表格不能超过 10 MB。");
  }
  return {
    fileName: format === "tsv" ? "粘贴表格.tsv" : "粘贴流水.csv",
    contentBase64: arrayBufferToBase64(bytes.buffer),
  };
}

export function createImportMapping(inspection) {
  const suggested = inspection?.suggestedMapping ?? {};
  return {
    date: suggested.date ?? "",
    amount: suggested.amount ?? "",
    transactionType: suggested.transactionType ?? "",
    description: suggested.description ?? "",
    category: suggested.category ?? "",
    currency: suggested.currency ?? "",
    externalId: suggested.externalId ?? "",
  };
}

export function validateImportMapping(mapping, inspection, accountId) {
  const headers = Array.isArray(inspection?.headers) ? inspection.headers : [];
  if (!accountId || typeof accountId !== "string") {
    return "请选择这份流水所属的账户。";
  }
  if (!mapping?.date || !headers.includes(mapping.date)) {
    return "请选择有效的日期列。";
  }
  if (!mapping?.amount || !headers.includes(mapping.amount)) {
    return "请选择有效的金额列。";
  }
  for (const [field, label] of [
    ["transactionType", "收支类型"],
    ["description", "流水说明"],
    ["category", "分类"],
    ["currency", "币种"],
    ["externalId", "外部流水号"],
  ]) {
    if (mapping[field] && !headers.includes(mapping[field])) {
      return `${label}列已经不存在，请重新选择。`;
    }
  }
  return "";
}

export function toImportDraftInput(filePayload, accountId, mapping) {
  return {
    ...filePayload,
    accountId,
    mapping: {
      date: mapping.date,
      amount: mapping.amount,
      transactionType: mapping.transactionType || null,
      description: mapping.description || null,
      category: mapping.category || null,
      currency: mapping.currency || null,
      externalId: mapping.externalId || null,
    },
  };
}

export function presentImportError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const known = [
    ["Only .csv, .tsv and .xlsx", "仅支持 CSV、TSV 和 XLSX 文件。"],
    ["must not exceed 10 MB", "单个导入文件不能超过 10 MB。"],
    ["does not contain a worksheet", "XLSX 文件中没有可读取的工作表。"],
    ["could not be opened", "XLSX 文件无法打开，请确认文件没有损坏或加密。"],
    ["could not be parsed", "表格文本无法解析，请确认使用 UTF-8 编码。"],
    ["duplicate column headings", "文件中存在重复列名，请先整理表头。"],
    ["No valid income or expense rows", "没有可供核对的有效收入或支出行。"],
    ["selected import account is unavailable", "所选账户不存在或已归档。"],
    ["currency changed after review", "核对后账户币种发生变化，请重新导入。"],
    ["changed before confirmation", "导入草稿在确认前发生变化，请重新核对。"],
    ["Vault is locked", "应用已经锁定，请重新解锁。"],
  ];
  return known.find(([needle]) => message.includes(needle))?.[1]
    ?? (message.length <= 180 ? message : "导入失败，请检查文件格式后重试。");
}

export function presentImportRowError(message) {
  const normalized = String(message ?? "");
  const known = [
    ["Date must be", "日期必须是有效的 YYYY-MM-DD。"],
    ["Amount must be", "金额必须是有效数字，且不能为零。"],
    ["Transaction type must be", "收支类型只能是收入或支出。"],
    ["does not match account currency", "该行币种与所选账户不一致。"],
    ["Description must not exceed", "流水说明不能超过 160 个字符。"],
    ["Category must not exceed", "分类不能超过 60 个字符。"],
    ["External identifier must not exceed", "外部流水号不能超过 160 个字符。"],
    ["External identifier is duplicated", "外部流水号在本次文件中重复。"],
  ];
  return known.find(([needle]) => normalized.includes(needle))?.[1]
    ?? (normalized.length <= 160 ? normalized : "该行内容无效，请检查源文件。");
}

export { MAX_IMPORT_BYTES };
