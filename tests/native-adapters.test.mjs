import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRepository } from "../src/data/local/localRepository.js";
import { createTauriVaultAdapter } from "../src/security/tauriVaultAdapter.js";

test("native speech forwards live partial results through a scoped IPC channel", async () => {
  let captured;
  let channelCallback;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      transformCallback(callback) {
        channelCallback = callback;
        return 7;
      },
      unregisterCallback() {},
    },
  };
  const repository = createLocalRepository(async (command, payload) => {
    captured = { command, payload };
    return { status: "transcribed", text: "测试语音", onDevice: true };
  });
  const events = [];

  try {
    await repository.transcribeSpeech({
      locale: "zh-CN",
      maxSeconds: 30,
      confirmedByUser: true,
    }, (event) => events.push(event));

    assert.equal(captured.command, "speech_transcribe_once");
    assert.equal(captured.payload.request.maxSeconds, 30);
    assert.equal(captured.payload.request.onEvent.toJSON(), "__CHANNEL__:7");
    channelCallback({ index: 0, message: { kind: "partial", text: "测试" } });
    assert.deepEqual(events, [{ kind: "partial", text: "测试" }]);
  } finally {
    delete globalThis.window;
  }
});

test("native speech exposes an explicit stop command for user-controlled review", async () => {
  let captured;
  const repository = createLocalRepository(async (command, payload) => {
    captured = { command, payload };
    return { status: "stop_requested", requested: true };
  });

  assert.deepEqual(await repository.stopSpeechCapture(), {
    status: "stop_requested",
    requested: true,
  });
  assert.deepEqual(captured, {
    command: "speech_stop_current",
    payload: undefined,
  });
});

test("local repository exposes only explicit native commands", async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return command === "vault_get_snapshot" ? { accounts: [] } : { ok: true };
  };
  const repository = createLocalRepository(invoke);

  assert.deepEqual(await repository.getSnapshot(), { accounts: [] });
  await repository.createAccountDraft({
    institutionName: "测试银行",
    displayName: "测试账户",
  });
  await repository.updateAccountDraft({
    accountId: "account-1",
    displayName: "更新账户",
  });
  await repository.archiveAccountDraft("account-2");
  await repository.confirmAccountDraft("draft-1");
  await repository.rejectAccountDraft("draft-2");
  await repository.createHoldingDraft({
    accountId: "account-1",
    name: "测试基金",
  });
  await repository.createHoldingValuationDraft({
    holdingId: "holding-1",
    marketValue: "52100.00",
  });
  await repository.updateHoldingDraft({
    holdingId: "holding-1",
    name: "更新基金",
  });
  await repository.archiveHoldingDraft({
    holdingId: "holding-2",
  });
  await repository.confirmHoldingDraft("draft-holding-1");
  await repository.rejectHoldingDraft("draft-holding-2");
  await repository.createHoldingOperationDraft({
    holdingId: "holding-1",
    operationKind: "dividend",
    amount: "128.00",
  });
  await repository.confirmHoldingOperationDraft("draft-operation-1");
  await repository.rejectHoldingOperationDraft("draft-operation-2");
  await repository.createHoldingOperationCorrectionDraft({
    operationId: "operation-1",
    reason: "误录",
    occurredOn: "2026-07-27",
  });
  await repository.confirmHoldingOperationCorrectionDraft("draft-operation-correction-1");
  await repository.rejectHoldingOperationCorrectionDraft("draft-operation-correction-2");
  await repository.createTransactionDraft({
    transactionKind: "expense",
    accountId: "account-1",
    amount: "368.00",
  });
  await repository.confirmTransactionDraft("draft-3");
  await repository.rejectTransactionDraft("draft-4");
  await repository.createTransactionCorrectionDraft({
    transactionId: "transaction-1",
    correctionKind: "reverse",
    reason: "重复流水",
    replacement: null,
  });
  await repository.confirmTransactionCorrectionDraft("draft-correction-1");
  await repository.rejectTransactionCorrectionDraft("draft-correction-2");
  await repository.inspectTransactionImport({
    fileName: "虚构流水.csv",
    contentBase64: "YSxi",
  });
  await repository.createTransactionImportDraft({
    fileName: "虚构流水.csv",
    contentBase64: "YSxi",
    accountId: "account-1",
    mapping: { date: "日期", amount: "金额" },
  });
  await repository.confirmTransactionImportDraft("draft-import-1");
  await repository.rejectTransactionImportDraft("draft-import-2");
  await repository.createReminderDraft({
    title: "虚构保险续缴",
    category: "insurance",
  });
  await repository.updateReminderDraft({
    reminderId: "reminder-1",
    title: "虚构保险续缴（更新）",
  });
  await repository.completeReminderDraft("reminder-1");
  await repository.archiveReminderDraft("reminder-2");
  await repository.confirmReminderDraft("draft-5");
  await repository.rejectReminderDraft("draft-6");
  await repository.recordAiProposal({
    domainDraftId: "draft-7",
    inputKind: "voice",
    proposalKind: "transaction",
    moduleContext: "cashflow",
    providerId: "local_rules_v1",
    parserVersion: "zh-finance-rules-1",
    transcript: "今天从测试账户花了三百六十八元",
    confidenceBps: 9200,
    evidence: [],
  });
  await repository.listAiProposals({
    status: "needs_review",
    limit: 25,
  });
  await repository.getModelProviderStatus();
  await repository.configureModelProvider("sk-test-abcdefghijklmnopqrstuvwxyz");
  await repository.testModelProvider();
  await repository.extractFinancialFactsWithModel({
    text: "今天从建行花了368元买日用品",
    moduleContext: "cashflow",
  });
  await repository.removeModelProvider();
  await repository.selectDocumentEvidence();
  await repository.transcribeSpeech({
    locale: "zh-CN",
    maxSeconds: 12,
    confirmedByUser: true,
  });
  await repository.stopSpeechCapture();
  await repository.createBackup({
    currentPassword: "correct horse battery staple",
    backupPassword: "independent backup password",
    confirmedByUser: true,
  });
  await repository.selectBackup();
  await repository.inspectBackup({
    selectionToken: "selection-1",
    backupPassword: "independent backup password",
  });
  await repository.discardBackupSelection("selection-old");
  await repository.confirmBackupRestore({
    restoreToken: "selection-1",
    backupPassword: "independent backup password",
    targetVaultId: "primary-restored",
    targetDisplayName: "恢复后的保险库",
    newPassword: "new restored vault password",
    confirmedByUser: true,
  });
  assert.deepEqual(calls, [
    ["vault_get_snapshot", undefined],
    ["account_create_draft", {
      request: {
        institutionName: "测试银行",
        displayName: "测试账户",
      },
    }],
    ["account_update_draft", {
      request: {
        accountId: "account-1",
        displayName: "更新账户",
      },
    }],
    ["account_archive_draft", {
      request: {
        accountId: "account-2",
      },
    }],
    ["account_confirm_draft", {
      request: {
        draftId: "draft-1",
        confirmedByUser: true,
      },
    }],
    ["account_reject_draft", {
      request: {
        draftId: "draft-2",
      },
    }],
    ["holding_create_draft", {
      request: {
        accountId: "account-1",
        name: "测试基金",
      },
    }],
    ["holding_valuation_create_draft", {
      request: {
        holdingId: "holding-1",
        marketValue: "52100.00",
      },
    }],
    ["holding_update_draft", {
      request: {
        holdingId: "holding-1",
        name: "更新基金",
      },
    }],
    ["holding_archive_draft", {
      request: {
        holdingId: "holding-2",
      },
    }],
    ["holding_confirm_draft", {
      request: {
        draftId: "draft-holding-1",
        confirmedByUser: true,
      },
    }],
    ["holding_reject_draft", {
      request: {
        draftId: "draft-holding-2",
      },
    }],
    ["holding_operation_create_draft", {
      request: {
        holdingId: "holding-1",
        operationKind: "dividend",
        amount: "128.00",
      },
    }],
    ["holding_operation_confirm_draft", {
      request: {
        draftId: "draft-operation-1",
        confirmedByUser: true,
      },
    }],
    ["holding_operation_reject_draft", {
      request: {
        draftId: "draft-operation-2",
      },
    }],
    ["holding_operation_correction_create_draft", {
      request: {
        operationId: "operation-1",
        reason: "误录",
        occurredOn: "2026-07-27",
      },
    }],
    ["holding_operation_correction_confirm_draft", {
      request: {
        draftId: "draft-operation-correction-1",
        confirmedByUser: true,
      },
    }],
    ["holding_operation_correction_reject_draft", {
      request: {
        draftId: "draft-operation-correction-2",
      },
    }],
    ["transaction_create_draft", {
      request: {
        transactionKind: "expense",
        accountId: "account-1",
        amount: "368.00",
      },
    }],
    ["transaction_confirm_draft", {
      request: {
        draftId: "draft-3",
        confirmedByUser: true,
      },
    }],
    ["transaction_reject_draft", {
      request: {
        draftId: "draft-4",
      },
    }],
    ["transaction_correction_create_draft", {
      request: {
        transactionId: "transaction-1",
        correctionKind: "reverse",
        reason: "重复流水",
        replacement: null,
      },
    }],
    ["transaction_correction_confirm_draft", {
      request: {
        draftId: "draft-correction-1",
        confirmedByUser: true,
      },
    }],
    ["transaction_correction_reject_draft", {
      request: {
        draftId: "draft-correction-2",
      },
    }],
    ["transaction_import_inspect", {
      request: {
        fileName: "虚构流水.csv",
        contentBase64: "YSxi",
      },
    }],
    ["transaction_import_create_draft", {
      request: {
        fileName: "虚构流水.csv",
        contentBase64: "YSxi",
        accountId: "account-1",
        mapping: { date: "日期", amount: "金额" },
      },
    }],
    ["transaction_import_confirm_draft", {
      request: {
        draftId: "draft-import-1",
        confirmedByUser: true,
      },
    }],
    ["transaction_import_reject_draft", {
      request: {
        draftId: "draft-import-2",
      },
    }],
    ["reminder_create_draft", {
      request: {
        title: "虚构保险续缴",
        category: "insurance",
      },
    }],
    ["reminder_update_draft", {
      request: {
        reminderId: "reminder-1",
        title: "虚构保险续缴（更新）",
      },
    }],
    ["reminder_complete_draft", {
      request: {
        reminderId: "reminder-1",
      },
    }],
    ["reminder_archive_draft", {
      request: {
        reminderId: "reminder-2",
      },
    }],
    ["reminder_confirm_draft", {
      request: {
        draftId: "draft-5",
        confirmedByUser: true,
      },
    }],
    ["reminder_reject_draft", {
      request: {
        draftId: "draft-6",
      },
    }],
    ["ai_proposal_record", {
      request: {
        domainDraftId: "draft-7",
        inputKind: "voice",
        proposalKind: "transaction",
        moduleContext: "cashflow",
        providerId: "local_rules_v1",
        parserVersion: "zh-finance-rules-1",
        transcript: "今天从测试账户花了三百六十八元",
        confidenceBps: 9200,
        evidence: [],
      },
    }],
    ["ai_proposal_list", {
      request: {
        status: "needs_review",
        limit: 25,
      },
    }],
    ["model_provider_status", undefined],
    ["model_provider_configure", {
      request: {
        apiKey: "sk-test-abcdefghijklmnopqrstuvwxyz",
        confirmedByUser: true,
      },
    }],
    ["model_provider_test", {
      request: {
        allowExternal: true,
        confirmedByUser: true,
      },
    }],
    ["model_extract_financial_facts", {
      request: {
        text: "今天从建行花了368元买日用品",
        moduleContext: "cashflow",
        allowExternal: true,
        confirmedByUser: true,
      },
    }],
    ["model_provider_remove", {
      request: {
        confirmedByUser: true,
      },
    }],
    ["document_extract_select", undefined],
    ["speech_transcribe_once", {
      request: {
        locale: "zh-CN",
        maxSeconds: 12,
        confirmedByUser: true,
      },
    }],
    ["speech_stop_current", undefined],
    ["vault_backup_create", {
      request: {
        currentPassword: "correct horse battery staple",
        backupPassword: "independent backup password",
        confirmedByUser: true,
      },
    }],
    ["vault_backup_select", undefined],
    ["vault_backup_inspect", {
      request: {
        selectionToken: "selection-1",
        backupPassword: "independent backup password",
      },
    }],
    ["vault_backup_discard", {
      request: {
        selectionToken: "selection-old",
      },
    }],
    ["vault_backup_confirm_restore", {
      request: {
        restoreToken: "selection-1",
        backupPassword: "independent backup password",
        targetVaultId: "primary-restored",
        targetDisplayName: "恢复后的保险库",
        newPassword: "new restored vault password",
        confirmedByUser: true,
      },
    }],
  ]);
});

test("local repository sync bridge only exchanges ciphertext envelopes", async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return { ok: true };
  };
  const repository = createLocalRepository(invoke);
  await repository.enableSync({
    cloudUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    platform: "macos",
    confirmedByUser: true,
  });
  await repository.getSyncStatus();
  await repository.prepareSyncOutbox(50);
  await repository.listSyncOutbox();
  await repository.recordSyncDelivery({
    eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    outcome: "synced",
    remoteReceivedAt: "2026-07-26T15:00:00.000Z",
  });
  await repository.applyIncomingSyncEvents({
    events: [{ event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
    cursorReceivedAt: "2026-07-26T15:01:00.000Z",
    cursorEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  await repository.listSyncConflicts(false);
  await repository.inspectSyncConflict(
    "sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  await repository.keepLocalSyncConflict({
    conflictId: "sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    confirmedByUser: true,
  });
  await repository.disableSync();
  assert.deepEqual(calls, [
    ["sync_enable", {
      request: {
        cloudUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        platform: "macos",
        confirmedByUser: true,
      },
    }],
    ["sync_status", undefined],
    ["sync_prepare_outbox", { request: { limit: 50 } }],
    ["sync_outbox_list", undefined],
    ["sync_record_delivery", {
      request: {
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        outcome: "synced",
        remoteReceivedAt: "2026-07-26T15:00:00.000Z",
      },
    }],
    ["sync_apply_incoming", {
      request: {
        events: [{ event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
        cursorReceivedAt: "2026-07-26T15:01:00.000Z",
        cursorEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    }],
    ["sync_conflicts_list", { request: { includeResolved: false } }],
    ["sync_conflict_inspect", {
      request: {
        conflictId: "sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    }],
    ["sync_conflict_keep_local", {
      request: {
        conflictId: "sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        confirmedByUser: true,
      },
    }],
    ["sync_disable", { confirmedByUser: true }],
  ]);
  assert.equal(
    JSON.stringify(calls).includes("syncKey"),
    false,
  );
  assert.equal(
    JSON.stringify(calls).includes("devicePrivateKey"),
    false,
  );
});

test("local notification bridge requires explicit native commands and exposes no reminder data", async () => {
  const calls = [];
  const repository = createLocalRepository(async (command, payload) => {
    calls.push([command, payload]);
    return { enabled: command === "notification_enable", privacyMode: "generic" };
  });

  await repository.getNotificationStatus();
  await repository.enableNotifications("generic");
  await repository.reconcileNotifications();
  await repository.disableNotifications();

  assert.deepEqual(calls, [
    ["notification_status", undefined],
    ["notification_enable", {
      request: { privacyMode: "generic", confirmedByUser: true },
    }],
    ["notification_reconcile", undefined],
    ["notification_disable", {
      request: { confirmedByUser: true },
    }],
  ]);
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /amount|account|notes|title/i);
});

test("vault adapter does not send a password for biometric unlock", async () => {
  const calls = [];
  const adapter = createTauriVaultAdapter(async (command, payload) => {
    calls.push([command, payload]);
    return { sessionId: "session-1" };
  });

  await adapter.unlock({
    vaultId: "vault-1",
    method: "biometric",
    password: "must-not-be-forwarded",
  });
  assert.deepEqual(calls[0], [
    "vault_unlock",
    {
      request: {
        vaultId: "vault-1",
        method: "biometric",
        password: null,
      },
    },
  ]);
});

test("vault adapter creates a password-protected local vault", async () => {
  const calls = [];
  const adapter = createTauriVaultAdapter(async (command, payload) => {
    calls.push([command, payload]);
    return { vaultId: "primary", sessionId: "session-1" };
  });

  await adapter.create({
    vaultId: "primary",
    displayName: "被子beizi",
    baseCurrency: "CNY",
    password: "correct horse battery staple",
  });
  assert.deepEqual(calls[0], [
    "vault_create",
    {
      request: {
        vaultId: "primary",
        displayName: "被子beizi",
        baseCurrency: "CNY",
        password: "correct horse battery staple",
      },
    },
  ]);
});

test("vault adapter lists local vault metadata without requesting secret material", async () => {
  const calls = [];
  const adapter = createTauriVaultAdapter(async (command, payload) => {
    calls.push([command, payload]);
    return [];
  });

  assert.deepEqual(await adapter.list(), []);
  assert.deepEqual(calls, [["vault_list", undefined]]);
});

test("vault adapter exposes reauthenticated biometric and password security commands", async () => {
  const calls = [];
  const adapter = createTauriVaultAdapter(async (command, payload) => {
    calls.push([command, payload]);
    return { available: true, enabled: false };
  });

  await adapter.biometricStatus("primary");
  await adapter.enableBiometric({
    vaultId: "primary",
    password: "correct horse battery staple",
  });
  await adapter.disableBiometric({
    vaultId: "primary",
    password: "correct horse battery staple",
  });
  await adapter.changePassword({
    vaultId: "primary",
    currentPassword: "correct horse battery staple",
    newPassword: "different private password",
  });
  assert.deepEqual(calls, [
    ["vault_biometric_status", { vaultId: "primary" }],
    [
      "vault_enable_biometric",
      {
        request: {
          vaultId: "primary",
          password: "correct horse battery staple",
          confirmedByUser: true,
        },
      },
    ],
    [
      "vault_disable_biometric",
      {
        request: {
          vaultId: "primary",
          password: "correct horse battery staple",
          confirmedByUser: true,
        },
      },
    ],
    [
      "vault_change_password",
      {
        request: {
          vaultId: "primary",
          currentPassword: "correct horse battery staple",
          newPassword: "different private password",
          confirmedByUser: true,
        },
      },
    ],
  ]);
});
