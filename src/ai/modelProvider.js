import {
  parseLocalProposal,
  proposalConfidenceBps,
} from "./localProposal.js";
import { answerLocalLedgerQuestion } from "./localLedgerQa.js";

export const MODEL_CAPABILITIES = Object.freeze([
  "extract_proposal",
  "answer_ledger",
  "transcribe_audio",
  "extract_document",
]);

function assertProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new Error("Model provider is required.");
  }
  if (typeof provider.id !== "string" || !provider.id.trim()) {
    throw new Error("Model provider identifier is invalid.");
  }
  if (!["device", "external"].includes(provider.dataBoundary)) {
    throw new Error("Model provider data boundary is invalid.");
  }
  if (!Array.isArray(provider.capabilities) || provider.capabilities.length === 0) {
    throw new Error("Model provider capabilities are required.");
  }
  for (const capability of provider.capabilities) {
    if (!MODEL_CAPABILITIES.includes(capability)) {
      throw new Error(`Unsupported model capability: ${capability}`);
    }
    if (typeof provider[capability] !== "function") {
      throw new Error(`Model provider does not implement ${capability}.`);
    }
  }
  return provider;
}

export const localModelProvider = Object.freeze(assertProvider({
  id: "folio_local_v1",
  label: "Folio 本地规则",
  dataBoundary: "device",
  capabilities: Object.freeze(["extract_proposal", "answer_ledger"]),
  extract_proposal: parseLocalProposal,
  answer_ledger: answerLocalLedgerQuestion,
  proposalConfidenceBps,
}));

export function createModelProviderRegistry(providers = [localModelProvider]) {
  const registry = new Map();
  for (const provider of providers) {
    const validated = assertProvider(provider);
    if (registry.has(validated.id)) {
      throw new Error(`Duplicate model provider: ${validated.id}`);
    }
    registry.set(validated.id, validated);
  }
  return Object.freeze({
    list() {
      return [...registry.values()].map((provider) => ({
        id: provider.id,
        label: provider.label ?? provider.id,
        dataBoundary: provider.dataBoundary,
        capabilities: [...provider.capabilities],
      }));
    },
    invoke({
      providerId = localModelProvider.id,
      capability,
      input,
      allowExternal = false,
    }) {
      if (!MODEL_CAPABILITIES.includes(capability)) {
        throw new Error("Requested model capability is invalid.");
      }
      const provider = registry.get(providerId);
      if (!provider || !provider.capabilities.includes(capability)) {
        throw new Error("Requested model provider capability is unavailable.");
      }
      if (provider.dataBoundary === "external" && allowExternal !== true) {
        throw new Error("External model use requires explicit consent for this request.");
      }
      return provider[capability](input);
    },
  });
}

export const defaultModelProviderRegistry = createModelProviderRegistry();
