import { Channel } from "@tauri-apps/api/core";

function assertInvoke(invoke) {
  if (typeof invoke !== "function") {
    throw new TypeError("A Tauri invoke function is required for local data mode.");
  }
  return invoke;
}

export function createLocalRepository(invokeFunction) {
  const invoke = assertInvoke(invokeFunction);

  return Object.freeze({
    kind: "local",

    async getSnapshot() {
      return invoke("vault_get_snapshot");
    },

    async createAccountDraft(input) {
      return invoke("account_create_draft", { request: input });
    },

    async updateAccountDraft(input) {
      return invoke("account_update_draft", { request: input });
    },

    async archiveAccountDraft(accountId) {
      return invoke("account_archive_draft", {
        request: { accountId },
      });
    },

    async confirmAccountDraft(draftId) {
      return invoke("account_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectAccountDraft(draftId) {
      return invoke("account_reject_draft", {
        request: { draftId },
      });
    },

    async createHoldingDraft(input) {
      return invoke("holding_create_draft", { request: input });
    },

    async createHoldingValuationDraft(input) {
      return invoke("holding_valuation_create_draft", { request: input });
    },

    async updateHoldingDraft(input) {
      return invoke("holding_update_draft", { request: input });
    },

    async archiveHoldingDraft(input) {
      return invoke("holding_archive_draft", { request: input });
    },

    async confirmHoldingDraft(draftId) {
      return invoke("holding_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectHoldingDraft(draftId) {
      return invoke("holding_reject_draft", {
        request: { draftId },
      });
    },

    async createHoldingOperationDraft(input) {
      return invoke("holding_operation_create_draft", { request: input });
    },

    async confirmHoldingOperationDraft(draftId) {
      return invoke("holding_operation_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectHoldingOperationDraft(draftId) {
      return invoke("holding_operation_reject_draft", {
        request: { draftId },
      });
    },

    async createHoldingOperationCorrectionDraft(input) {
      return invoke("holding_operation_correction_create_draft", { request: input });
    },

    async confirmHoldingOperationCorrectionDraft(draftId) {
      return invoke("holding_operation_correction_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectHoldingOperationCorrectionDraft(draftId) {
      return invoke("holding_operation_correction_reject_draft", {
        request: { draftId },
      });
    },

    async createTransactionDraft(input) {
      return invoke("transaction_create_draft", { request: input });
    },

    async confirmTransactionDraft(draftId) {
      return invoke("transaction_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectTransactionDraft(draftId) {
      return invoke("transaction_reject_draft", {
        request: { draftId },
      });
    },

    async createTransactionCorrectionDraft(input) {
      return invoke("transaction_correction_create_draft", { request: input });
    },

    async confirmTransactionCorrectionDraft(draftId) {
      return invoke("transaction_correction_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectTransactionCorrectionDraft(draftId) {
      return invoke("transaction_correction_reject_draft", {
        request: { draftId },
      });
    },

    async createReminderDraft(input) {
      return invoke("reminder_create_draft", { request: input });
    },

    async updateReminderDraft(input) {
      return invoke("reminder_update_draft", { request: input });
    },

    async completeReminderDraft(reminderId) {
      return invoke("reminder_complete_draft", {
        request: { reminderId },
      });
    },

    async archiveReminderDraft(reminderId) {
      return invoke("reminder_archive_draft", {
        request: { reminderId },
      });
    },

    async confirmReminderDraft(draftId) {
      return invoke("reminder_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectReminderDraft(draftId) {
      return invoke("reminder_reject_draft", {
        request: { draftId },
      });
    },

    async getNotificationStatus() {
      return invoke("notification_status");
    },

    async enableNotifications(privacyMode = "generic") {
      return invoke("notification_enable", {
        request: { privacyMode, confirmedByUser: true },
      });
    },

    async disableNotifications() {
      return invoke("notification_disable", {
        request: { confirmedByUser: true },
      });
    },

    async reconcileNotifications() {
      return invoke("notification_reconcile");
    },

    async savePlanningDraft(input) {
      return invoke("planning_profile_save_draft", { request: input });
    },

    async confirmPlanningDraft(draftId) {
      return invoke("planning_profile_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectPlanningDraft(draftId) {
      return invoke("planning_profile_reject_draft", {
        request: { draftId },
      });
    },

    async recordAiProposal(request) {
      return invoke("ai_proposal_record", { request });
    },

    async listAiProposals({ status = null, limit = 50 } = {}) {
      return invoke("ai_proposal_list", {
        request: { status, limit },
      });
    },

    async getModelProviderStatus() {
      return invoke("model_provider_status");
    },

    async configureModelProvider(apiKey) {
      return invoke("model_provider_configure", {
        request: { apiKey, confirmedByUser: true },
      });
    },

    async removeModelProvider() {
      return invoke("model_provider_remove", {
        request: { confirmedByUser: true },
      });
    },

    async testModelProvider() {
      return invoke("model_provider_test", {
        request: { allowExternal: true, confirmedByUser: true },
      });
    },

    async extractFinancialFactsWithModel({ text, moduleContext }) {
      return invoke("model_extract_financial_facts", {
        request: {
          text,
          moduleContext,
          allowExternal: true,
          confirmedByUser: true,
        },
      });
    },

    async getCodexCliStatus() {
      return invoke("codex_cli_status");
    },

    async analyzeFinanceInputWithCodex({ text, moduleContext }) {
      return invoke("codex_cli_analyze_finance", {
        request: {
          text,
          moduleContext,
          confirmedByUser: true,
        },
      });
    },

    async listEmailSources() {
      return invoke("email_source_list");
    },

    async configureEmailSource(input) {
      return invoke("email_source_configure", {
        request: { ...input, confirmedByUser: true },
      });
    },

    async testEmailSource(sourceId) {
      return invoke("email_source_test", {
        request: { sourceId, confirmedByUser: true },
      });
    },

    async syncEmailSource(sourceId) {
      return invoke("email_source_sync", {
        request: { sourceId, confirmedByUser: true },
      });
    },

    async removeEmailSource(sourceId) {
      return invoke("email_source_remove", {
        request: { sourceId, confirmedByUser: true },
      });
    },

    async selectDocumentEvidence() {
      return invoke("document_extract_select");
    },

    async transcribeSpeech(request, onEvent) {
      if (typeof onEvent !== "function") {
        return invoke("speech_transcribe_once", { request });
      }
      const onSpeechEvent = new Channel();
      onSpeechEvent.onmessage = onEvent;
      return invoke("speech_transcribe_once", {
        request: { ...request, onEvent: onSpeechEvent },
      });
    },

    async stopSpeechCapture() {
      return invoke("speech_stop_current");
    },

    async createDraft(input) {
      return invoke("draft_create", { input });
    },

    async confirmDraft(draftId, confirmation) {
      return invoke("draft_confirm", { draftId, confirmation });
    },

    async inspectTransactionImport(request) {
      return invoke("transaction_import_inspect", { request });
    },

    async createTransactionImportDraft(request) {
      return invoke("transaction_import_create_draft", { request });
    },

    async confirmTransactionImportDraft(draftId) {
      return invoke("transaction_import_confirm_draft", {
        request: { draftId, confirmedByUser: true },
      });
    },

    async rejectTransactionImportDraft(draftId) {
      return invoke("transaction_import_reject_draft", {
        request: { draftId },
      });
    },

    async createBackup(request) {
      return invoke("vault_backup_create", { request });
    },

    async createDataExport(request) {
      return invoke("vault_data_export_create", { request });
    },

    async saveMarkdownExport(request) {
      return invoke("markdown_export_save", { request });
    },

    async selectBackup() {
      return invoke("vault_backup_select");
    },

    async inspectBackup(request) {
      return invoke("vault_backup_inspect", { request });
    },

    async discardBackupSelection(selectionToken) {
      return invoke("vault_backup_discard", {
        request: { selectionToken },
      });
    },

    async confirmBackupRestore(request) {
      return invoke("vault_backup_confirm_restore", { request });
    },

    async enableSync(request) {
      return invoke("sync_enable", { request });
    },

    async getSyncStatus() {
      return invoke("sync_status");
    },

    async prepareSyncOutbox(limit = 250) {
      return invoke("sync_prepare_outbox", {
        request: { limit },
      });
    },

    async listSyncOutbox() {
      return invoke("sync_outbox_list");
    },

    async recordSyncDelivery(request) {
      return invoke("sync_record_delivery", { request });
    },

    async applyIncomingSyncEvents(request) {
      return invoke("sync_apply_incoming", { request });
    },

    async listSyncConflicts(includeResolved = false) {
      return invoke("sync_conflicts_list", {
        request: { includeResolved },
      });
    },

    async inspectSyncConflict(conflictId) {
      return invoke("sync_conflict_inspect", {
        request: { conflictId },
      });
    },

    async keepLocalSyncConflict(request) {
      return invoke("sync_conflict_keep_local", {
        request,
      });
    },

    async disableSync() {
      return invoke("sync_disable", { confirmedByUser: true });
    },
  });
}
