import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRepository } from "../src/data/local/localRepository.js";

test("QQ email source adapter keeps external reads and ledger confirmation explicit", async () => {
  const calls = [];
  const repository = createLocalRepository(async (command, payload) => {
    calls.push([command, payload]);
    return { command };
  });

  await repository.listEmailSources();
  await repository.configureEmailSource({
    emailAddress: "demo@qq.com",
    authorizationCode: "fictional-auth-code",
    accountId: "card-account",
    mailbox: "INBOX",
    allowedSenders: ["cmbchina.com"],
    subjectKeywords: ["消费提醒"],
  });
  await repository.testEmailSource("source-1");
  await repository.syncEmailSource("source-1");
  await repository.removeEmailSource("source-1");

  assert.deepEqual(calls, [
    ["email_source_list", undefined],
    ["email_source_configure", {
      request: {
        emailAddress: "demo@qq.com",
        authorizationCode: "fictional-auth-code",
        accountId: "card-account",
        mailbox: "INBOX",
        allowedSenders: ["cmbchina.com"],
        subjectKeywords: ["消费提醒"],
        confirmedByUser: true,
      },
    }],
    ["email_source_test", {
      request: { sourceId: "source-1", confirmedByUser: true },
    }],
    ["email_source_sync", {
      request: { sourceId: "source-1", confirmedByUser: true },
    }],
    ["email_source_remove", {
      request: { sourceId: "source-1", confirmedByUser: true },
    }],
  ]);
});
