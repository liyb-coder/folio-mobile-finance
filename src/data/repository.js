import { readRuntimeConfig } from "../config/runtime.js";
import { createDemoRepository } from "./demo/demoRepository.js";
import { createLocalRepository } from "./local/localRepository.js";

const REQUIRED_METHODS = Object.freeze(["getSnapshot"]);

export function assertDataRepository(repository) {
  if (!repository || typeof repository !== "object") {
    throw new TypeError("A data repository object is required.");
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Data repository must implement ${method}().`);
    }
  }

  return repository;
}

export function createDataRepository(config = readRuntimeConfig(), adapters = {}) {
  if (config.dataMode === "demo") {
    return assertDataRepository(createDemoRepository());
  }
  if (config.dataMode === "local") {
    return assertDataRepository(createLocalRepository(adapters.invoke));
  }

  throw new Error(
    `The "${config.dataMode}" data adapter is not implemented yet. `
      + "Use demo mode until its milestone is complete.",
  );
}

export { REQUIRED_METHODS };
