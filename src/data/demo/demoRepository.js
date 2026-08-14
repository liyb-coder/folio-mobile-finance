import { demoSnapshot } from "./demoSnapshot.js";

function cloneSnapshot() {
  return structuredClone(demoSnapshot);
}

export function createDemoRepository() {
  return Object.freeze({
    kind: "demo",
    getSnapshot: cloneSnapshot,
  });
}
