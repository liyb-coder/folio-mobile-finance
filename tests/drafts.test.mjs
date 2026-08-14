import assert from "node:assert/strict";
import test from "node:test";
import { DraftService } from "../src/domain/drafts.js";
import { InMemoryLedger } from "../src/domain/ledger.js";

function setup() {
  let eventId = 0;
  const ledger = new InMemoryLedger({
    clock: () => new Date("2026-07-24T00:00:00.000Z"),
    idFactory: () => `event-${++eventId}`,
  });
  const drafts = new DraftService({
    ledger,
    clock: () => new Date("2026-07-24T00:00:01.000Z"),
    idFactory: () => "draft-1",
  });
  return { ledger, drafts };
}

function draftInput() {
  return {
    source: "voice",
    proposedEvents: [{
      id: "item-1",
      confidence: 0.96,
      evidence: [{ transcriptRange: [0, 8] }],
      event: {
        vaultId: "vault-1",
        accountId: "account-1",
        eventType: "expense",
        deltaMinor: "-5000000",
        currency: "CNY",
        occurredAt: "2026-07-24T00:00:00.000Z",
      },
    }],
  };
}

test("drafts cannot change the ledger without explicit confirmation", () => {
  const { ledger, drafts } = setup();
  const draft = drafts.createDraft(draftInput());
  assert.equal(draft.status, "needs_review");
  assert.equal(ledger.listEvents().length, 0);
  assert.throws(
    () => drafts.confirmDraft(draft.id, { selectedItemIds: ["item-1"] }),
    /Explicit user confirmation/,
  );
  assert.equal(ledger.listEvents().length, 0);
});

test("confirmed draft writes selected events once", () => {
  const { ledger, drafts } = setup();
  const draft = drafts.createDraft(draftInput());
  const confirmation = {
    confirmedByUser: true,
    confirmedBy: "local-user",
    selectedItemIds: ["item-1"],
  };
  const first = drafts.confirmDraft(draft.id, confirmation);
  const retry = drafts.confirmDraft(draft.id, confirmation);

  assert.deepEqual(retry, first);
  assert.equal(ledger.listEvents().length, 1);
  assert.equal(ledger.listEvents()[0].metadata.draftId, "draft-1");
});
