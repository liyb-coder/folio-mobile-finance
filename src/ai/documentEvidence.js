const MAX_MATCHED_BLOCKS = 8;

function finiteRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => Number.isInteger(item) && item >= 0)
    && value[1] >= value[0];
}

function overlaps(left, right) {
  return left[0] < right[1] && right[0] < left[1];
}

function compactBlock(block) {
  return {
    page: block.page,
    range: [block.rangeStart, block.rangeEnd],
    ...(Number.isInteger(block.confidenceBps)
      ? { confidenceBps: block.confidenceBps }
      : {}),
    ...(block.boundingBox ? { boundingBox: block.boundingBox } : {}),
  };
}

export function attachDocumentEvidence(proposal, document) {
  if (!proposal || !document || document.status !== "extracted") return proposal;
  const blocks = Array.isArray(document.evidence) ? document.evidence : [];
  const source = {
    source: "local_document",
    fileName: document.fileName,
    fileHash: document.fileHash,
    format: document.format,
    byteCount: document.byteCount,
    pageCount: document.pageCount,
    ocrPageCount: document.ocrPageCount ?? 0,
    unreadablePageCount: document.unreadablePageCount ?? 0,
    truncated: Boolean(document.truncated),
    originalStored: false,
    privacy: "device_only_ephemeral",
  };
  const mapped = (proposal.evidence ?? []).map((item) => {
    if (!finiteRange(item.range)) return item;
    const matches = blocks
      .filter((block) => (
        finiteRange([block.rangeStart, block.rangeEnd])
        && overlaps(item.range, [block.rangeStart, block.rangeEnd])
      ))
      .slice(0, MAX_MATCHED_BLOCKS)
      .map(compactBlock);
    if (matches.length === 0) return item;
    return {
      ...item,
      document: {
        fileHash: document.fileHash,
        pages: [...new Set(matches.map((block) => block.page))],
        blocks: matches,
      },
    };
  });
  const warnings = [...(proposal.warnings ?? [])];
  if (document.truncated && !(document.unreadablePageCount > 0)) {
    warnings.push("文件文字超过本地解析上限，本次只核对前 40000 个字符。");
  }
  if (document.unreadablePageCount > 0) {
    warnings.push(`文件有 ${document.unreadablePageCount} 页未识别，本次提案只基于其余可读页面。`);
  }
  return {
    ...proposal,
    inputKind: "file",
    evidence: [source, ...mapped],
    warnings,
  };
}
