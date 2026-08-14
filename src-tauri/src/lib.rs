mod accounts;
mod ai;
mod backups;
mod codex_cli;
#[cfg(test)]
mod cold_start_e2e;
mod crypto;
mod database;
mod documents;
mod email_ingestion;
mod exports;
mod holding_operations;
mod holdings;
mod imports;
mod keychain;
mod model_gateway;
mod notifications;
mod planning;
mod reminders;
mod speech;
mod sync;
mod transactions;
mod vault;

use vault::VaultRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultRuntime::default())
        .manage(backups::BackupRuntime::default())
        .manage(speech::SpeechRuntime::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            accounts::account_archive_draft,
            accounts::account_create_draft,
            accounts::account_confirm_draft,
            accounts::account_reject_draft,
            accounts::account_update_draft,
            ai::ai_proposal_list,
            ai::ai_proposal_record,
            model_gateway::model_extract_financial_facts,
            model_gateway::model_provider_configure,
            model_gateway::model_provider_remove,
            model_gateway::model_provider_status,
            model_gateway::model_provider_test,
            backups::vault_backup_confirm_restore,
            backups::vault_backup_create,
            backups::vault_backup_discard,
            backups::vault_backup_inspect,
            backups::vault_backup_select,
            codex_cli::codex_cli_analyze_finance,
            codex_cli::codex_cli_status,
            documents::document_extract_select,
            email_ingestion::email_source_configure,
            email_ingestion::email_source_list,
            email_ingestion::email_source_remove,
            email_ingestion::email_source_sync,
            email_ingestion::email_source_test,
            exports::markdown_export_save,
            exports::vault_data_export_create,
            holdings::holding_confirm_draft,
            holdings::holding_create_draft,
            holdings::holding_archive_draft,
            holdings::holding_reject_draft,
            holdings::holding_update_draft,
            holdings::holding_valuation_create_draft,
            holding_operations::holding_operation_confirm_draft,
            holding_operations::holding_operation_create_draft,
            holding_operations::holding_operation_reject_draft,
            holding_operations::holding_operation_correction_confirm_draft,
            holding_operations::holding_operation_correction_create_draft,
            holding_operations::holding_operation_correction_reject_draft,
            planning::planning_profile_confirm_draft,
            planning::planning_profile_reject_draft,
            planning::planning_profile_save_draft,
            reminders::reminder_archive_draft,
            reminders::reminder_complete_draft,
            reminders::reminder_confirm_draft,
            reminders::reminder_create_draft,
            reminders::reminder_reject_draft,
            reminders::reminder_update_draft,
            speech::speech_stop_current,
            speech::speech_transcribe_once,
            sync::sync_disable,
            sync::sync_enable,
            sync::sync_apply_incoming,
            sync::sync_conflict_inspect,
            sync::sync_conflict_keep_local,
            sync::sync_conflicts_list,
            sync::sync_outbox_list,
            sync::sync_prepare_outbox,
            sync::sync_record_delivery,
            sync::sync_status,
            transactions::transaction_correction_confirm_draft,
            transactions::transaction_correction_create_draft,
            transactions::transaction_correction_reject_draft,
            transactions::transaction_confirm_draft,
            transactions::transaction_create_draft,
            transactions::transaction_reject_draft,
            imports::transaction_import_confirm_draft,
            imports::transaction_import_create_draft,
            imports::transaction_import_inspect,
            imports::transaction_import_reject_draft,
            notifications::notification_disable,
            notifications::notification_enable,
            notifications::notification_reconcile,
            notifications::notification_status,
            vault::vault_create,
            vault::vault_list,
            vault::vault_biometric_status,
            vault::vault_clear_all_data,
            vault::vault_change_password,
            vault::vault_disable_biometric,
            vault::vault_enable_biometric,
            vault::vault_status,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_get_snapshot,
        ])
        .setup(|app| {
            notifications::initialize();
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
