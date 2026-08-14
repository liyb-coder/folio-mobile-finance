use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_TRANSCRIPT_CHARS: usize = 40_000;
const MAX_EVIDENCE_BYTES: usize = 32 * 1024;

fn random_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).map_err(|_| "Unable to create a secure proposal identifier.".to_owned())?;
    Ok(format!("{prefix}_{}", hex::encode(bytes)))
}

fn normalized_enum(value: String, allowed: &[&str], label: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if !allowed.contains(&normalized.as_str()) {
        return Err(format!("{label} is unsupported."));
    }
    Ok(normalized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAiProposalRequest {
    domain_draft_id: String,
    input_kind: String,
    proposal_kind: String,
    module_context: String,
    provider_id: String,
    parser_version: String,
    transcript: String,
    confidence_bps: i64,
    evidence: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProposalResponse {
    proposal_id: String,
    domain_draft_id: String,
    status: &'static str,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAiProposalsRequest {
    status: Option<String>,
    limit: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInboxItem {
    proposal_id: String,
    domain_draft_id: String,
    input_kind: String,
    proposal_kind: String,
    module_context: String,
    provider_id: String,
    transcript_preview: String,
    confidence_bps: i64,
    evidence_count: usize,
    draft_status: String,
    proposed_events: Value,
    created_at: String,
}

fn list_ai_proposals_at(
    connection: &rusqlite::Connection,
    vault_id: &str,
    request: ListAiProposalsRequest,
) -> Result<Vec<AiInboxItem>, String> {
    let status = request
        .status
        .map(|value| {
            normalized_enum(
                value,
                &["needs_review", "confirmed", "rejected"],
                "AI inbox status",
            )
        })
        .transpose()?;
    let limit = i64::from(request.limit.unwrap_or(50).clamp(1, 100));
    let mut statement = connection
        .prepare(
            "SELECT
                proposal.id, proposal.domain_draft_id, proposal.input_kind,
                proposal.proposal_kind, proposal.module_context, proposal.provider_id,
                proposal.transcript, proposal.confidence_bps, proposal.evidence_json,
                draft.status, draft.proposed_events_json, proposal.created_at
             FROM ai_proposals proposal
             JOIN draft_changes draft
               ON draft.id = proposal.domain_draft_id
              AND draft.vault_id = proposal.vault_id
             WHERE proposal.vault_id = ?1
               AND (?2 IS NULL OR draft.status = ?2)
             ORDER BY proposal.created_at DESC, proposal.id DESC
             LIMIT ?3",
        )
        .map_err(|_| "Unable to prepare the encrypted AI inbox.".to_owned())?;
    let rows = statement
        .query_map(params![vault_id, status, limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })
        .map_err(|_| "Unable to read the encrypted AI inbox.".to_owned())?;

    let mut items = Vec::new();
    for row in rows {
        let (
            proposal_id,
            domain_draft_id,
            input_kind,
            proposal_kind,
            module_context,
            provider_id,
            transcript,
            confidence_bps,
            evidence_json,
            draft_status,
            proposed_events_json,
            created_at,
        ) = row.map_err(|_| "Unable to decode an encrypted AI inbox item.".to_owned())?;
        let transcript_preview = transcript.chars().take(140).collect::<String>();
        let evidence_count = serde_json::from_str::<Vec<Value>>(&evidence_json)
            .map(|items| items.len())
            .unwrap_or(0);
        let proposed_events = serde_json::from_str(&proposed_events_json)
            .map_err(|_| "An AI inbox item contains invalid proposed events.".to_owned())?;
        items.push(AiInboxItem {
            proposal_id,
            domain_draft_id,
            input_kind,
            proposal_kind,
            module_context,
            provider_id,
            transcript_preview,
            confidence_bps,
            evidence_count,
            draft_status,
            proposed_events,
            created_at,
        });
    }
    Ok(items)
}

fn record_ai_proposal_at(
    connection: &mut rusqlite::Connection,
    vault_id: &str,
    request: RecordAiProposalRequest,
) -> Result<AiProposalResponse, String> {
    let domain_draft_id = request.domain_draft_id.trim().to_owned();
    if domain_draft_id.is_empty() || domain_draft_id.len() > 96 {
        return Err("Domain draft identifier is invalid.".to_owned());
    }
    let input_kind = normalized_enum(request.input_kind, &["text", "voice", "file"], "Input kind")?;
    let proposal_kind = normalized_enum(
        request.proposal_kind,
        &[
            "account",
            "holding_operation",
            "transaction",
            "reminder",
            "planning",
        ],
        "Proposal kind",
    )?;
    let module_context = normalized_enum(
        request.module_context,
        &[
            "overview",
            "assets",
            "cashflow",
            "planning",
            "reminders",
            "assistant",
            "sources",
            "settings",
        ],
        "Module context",
    )?;
    let provider_id = normalized_enum(
        request.provider_id,
        &["local_rules_v1", "openai_responses_v1", "codex_cli_v1"],
        "AI proposal provider",
    )?;
    let parser_version = request.parser_version.trim().to_owned();
    if parser_version.is_empty()
        || parser_version.len() > 64
        || !parser_version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err("AI parser version is invalid.".to_owned());
    }
    let transcript = request.transcript.trim().to_owned();
    if transcript.is_empty() || transcript.chars().count() > MAX_TRANSCRIPT_CHARS {
        return Err("AI proposal transcript must contain 1 to 40000 characters.".to_owned());
    }
    if request.confidence_bps < 0 || request.confidence_bps > 10_000 {
        return Err("AI proposal confidence is invalid.".to_owned());
    }
    if !request.evidence.is_array() {
        return Err("AI proposal evidence must be an array.".to_owned());
    }
    let evidence_json = serde_json::to_string(&request.evidence)
        .map_err(|_| "Unable to serialize AI proposal evidence.".to_owned())?;
    if evidence_json.len() > MAX_EVIDENCE_BYTES {
        return Err("AI proposal evidence is too large.".to_owned());
    }

    if let Some(proposal_id) = connection
        .query_row(
            "SELECT id FROM ai_proposals
             WHERE vault_id = ?1 AND domain_draft_id = ?2",
            params![vault_id, domain_draft_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "Unable to inspect AI proposal idempotency.".to_owned())?
    {
        return Ok(AiProposalResponse {
            proposal_id,
            domain_draft_id,
            status: "needs_review",
        });
    }

    let expected_source_type = match proposal_kind.as_str() {
        "account" => "manual_account",
        "holding_operation" => "manual_holding_operation",
        "transaction" => "manual_transaction",
        "reminder" => "manual_reminder",
        "planning" => "manual_planning",
        _ => unreachable!(),
    };
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start AI proposal recording.".to_owned())?;
    let draft: Option<(String, String, String)> = transaction
        .query_row(
            "SELECT source_type, status, evidence_json
             FROM draft_changes WHERE id = ?1 AND vault_id = ?2",
            params![domain_draft_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Unable to read the AI proposal domain draft.".to_owned())?;
    let (source_type, status, existing_evidence_json) =
        draft.ok_or_else(|| "AI proposal domain draft does not exist.".to_owned())?;
    if source_type != expected_source_type || status != "needs_review" {
        return Err("AI proposal must link to a matching pending review draft.".to_owned());
    }

    let proposal_id = random_id("ai_proposal")?;
    let mut hasher = Sha256::new();
    hasher.update(b"folio:ai-proposal-transcript:v1\0");
    hasher.update(vault_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(module_context.as_bytes());
    hasher.update(b"\0");
    hasher.update(transcript.as_bytes());
    let transcript_hash = hasher.finalize().to_vec();
    transaction
        .execute(
            "INSERT INTO ai_proposals(
                id, vault_id, domain_draft_id, input_kind, proposal_kind,
                module_context, provider_id, parser_version, transcript,
                transcript_hash, confidence_bps, evidence_json, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                proposal_id,
                vault_id,
                domain_draft_id,
                input_kind,
                proposal_kind,
                module_context,
                provider_id,
                parser_version,
                transcript,
                transcript_hash,
                request.confidence_bps,
                evidence_json,
            ],
        )
        .map_err(|_| "Unable to save the encrypted AI proposal evidence.".to_owned())?;

    let mut existing_evidence: Vec<Value> =
        serde_json::from_str(&existing_evidence_json).unwrap_or_default();
    existing_evidence.push(json!({
        "source": input_kind,
        "aiProposalId": proposal_id,
        "provider": provider_id,
        "parserVersion": parser_version,
        "confidenceBps": request.confidence_bps,
        "reviewRequired": true
    }));
    transaction
        .execute(
            "UPDATE draft_changes SET evidence_json = ?1
             WHERE id = ?2 AND vault_id = ?3 AND status = 'needs_review'",
            params![
                serde_json::to_string(&existing_evidence)
                    .map_err(|_| "Unable to link AI proposal evidence.".to_owned())?,
                domain_draft_id,
                vault_id
            ],
        )
        .map_err(|_| "Unable to link AI evidence to its review draft.".to_owned())?;
    transaction
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'ai', 'proposal_recorded', 'local_rules',
                'draft_change', ?3, ?4,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                vault_id,
                domain_draft_id,
                json!({
                    "proposalId": proposal_id,
                    "inputKind": input_kind,
                    "proposalKind": proposal_kind,
                    "moduleContext": module_context,
                    "provider": provider_id,
                    "parserVersion": parser_version,
                    "confidenceBps": request.confidence_bps
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to audit the AI proposal.".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit the AI proposal evidence.".to_owned())?;
    Ok(AiProposalResponse {
        proposal_id,
        domain_draft_id,
        status: "needs_review",
    })
}

#[tauri::command]
pub async fn ai_proposal_record(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RecordAiProposalRequest,
) -> Result<AiProposalResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            record_ai_proposal_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "AI proposal recording task failed.".to_owned())?
}

#[tauri::command]
pub async fn ai_proposal_list(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ListAiProposalsRequest,
) -> Result<Vec<AiInboxItem>, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            list_ai_proposals_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "AI inbox listing task failed.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute_batch(
                "
                INSERT INTO vaults(id, display_name, base_currency, created_at)
                VALUES ('vault-1', 'AI 测试保险库', 'CNY', '2026-07-26T00:00:00.000Z');
                INSERT INTO draft_changes(
                  id, vault_id, source_type, status, proposed_events_json,
                  evidence_json, created_at
                ) VALUES (
                  'draft-1', 'vault-1', 'manual_transaction', 'needs_review',
                  '{}', '[]', '2026-07-26T20:00:00.000Z'
                );
                ",
            )
            .expect("fixture should insert");
        connection
    }

    fn request() -> RecordAiProposalRequest {
        RecordAiProposalRequest {
            domain_draft_id: "draft-1".to_owned(),
            input_kind: "text".to_owned(),
            proposal_kind: "transaction".to_owned(),
            module_context: "cashflow".to_owned(),
            provider_id: "local_rules_v1".to_owned(),
            parser_version: "zh-finance-rules-1".to_owned(),
            transcript: "今天从工资账户花了三百六十八买日用品。".to_owned(),
            confidence_bps: 8_600,
            evidence: json!([
                {"field": "amount", "range": [9, 14], "text": "三百六十八"}
            ]),
        }
    }

    #[test]
    fn proposal_evidence_is_immutable_and_never_confirms_the_domain_draft() {
        let mut connection = fixture();
        let first = record_ai_proposal_at(&mut connection, "vault-1", request())
            .expect("proposal should record");
        let second = record_ai_proposal_at(&mut connection, "vault-1", request())
            .expect("same domain draft should be idempotent");
        assert_eq!(first.proposal_id, second.proposal_id);
        let status: String = connection
            .query_row(
                "SELECT status FROM draft_changes WHERE id = 'draft-1'",
                [],
                |row| row.get(0),
            )
            .expect("draft should exist");
        assert_eq!(status, "needs_review");
        let ledger_count: i64 = connection
            .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
            .expect("ledger should be readable");
        assert_eq!(ledger_count, 0);
        assert!(connection
            .execute(
                "UPDATE ai_proposals SET confidence_bps = 10000
                 WHERE id = ?1",
                [&first.proposal_id],
            )
            .is_err());
    }

    #[test]
    fn codex_cli_proposal_is_a_review_source_not_a_confirmation() {
        let mut connection = fixture();
        let mut codex_request = request();
        codex_request.provider_id = "codex_cli_v1".to_owned();
        codex_request.parser_version = "codex-cli-semantic-1.zh-finance-rules-3".to_owned();
        record_ai_proposal_at(&mut connection, "vault-1", codex_request)
            .expect("Codex CLI proposal should record as review evidence");
        let status: String = connection
            .query_row(
                "SELECT status FROM draft_changes WHERE id = 'draft-1'",
                [],
                |row| row.get(0),
            )
            .expect("draft should exist");
        assert_eq!(status, "needs_review");
    }

    #[test]
    fn proposal_cannot_attach_to_a_mismatched_or_confirmed_draft() {
        let mut connection = fixture();
        let mut wrong_kind = request();
        wrong_kind.proposal_kind = "reminder".to_owned();
        assert!(record_ai_proposal_at(&mut connection, "vault-1", wrong_kind).is_err());
        connection
            .execute(
                "UPDATE draft_changes SET status = 'confirmed' WHERE id = 'draft-1'",
                [],
            )
            .expect("fixture should confirm");
        assert!(record_ai_proposal_at(&mut connection, "vault-1", request()).is_err());
    }

    #[test]
    fn holding_operation_proposal_links_only_to_a_pending_operation_draft() {
        let mut connection = fixture();
        connection
            .execute(
                "INSERT INTO draft_changes(
                    id, vault_id, source_type, status, proposed_events_json,
                    evidence_json, created_at
                 ) VALUES (
                    'draft-holding-operation', 'vault-1',
                    'manual_holding_operation', 'needs_review',
                    '{}', '[]', '2026-07-27T00:00:00.000Z'
                 )",
                [],
            )
            .expect("holding operation draft should insert");
        let mut holding_request = request();
        holding_request.domain_draft_id = "draft-holding-operation".to_owned();
        holding_request.proposal_kind = "holding_operation".to_owned();
        holding_request.module_context = "assets".to_owned();
        holding_request.parser_version = "zh-finance-rules-3".to_owned();
        holding_request.transcript = "今天沪深300基金分红128元。".to_owned();
        let response = record_ai_proposal_at(&mut connection, "vault-1", holding_request)
            .expect("holding operation proposal should record");
        assert_eq!(response.domain_draft_id, "draft-holding-operation");
        let stored_kind: String = connection
            .query_row(
                "SELECT proposal_kind FROM ai_proposals
                 WHERE domain_draft_id = 'draft-holding-operation'",
                [],
                |row| row.get(0),
            )
            .expect("proposal should exist");
        assert_eq!(stored_kind, "holding_operation");
    }

    #[test]
    fn inbox_lists_only_requested_review_state_without_changing_the_ledger() {
        let mut connection = fixture();
        record_ai_proposal_at(&mut connection, "vault-1", request())
            .expect("proposal should record");
        let pending = list_ai_proposals_at(
            &connection,
            "vault-1",
            ListAiProposalsRequest {
                status: Some("needs_review".to_owned()),
                limit: Some(10),
            },
        )
        .expect("pending inbox should list");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].draft_status, "needs_review");
        assert_eq!(pending[0].proposal_kind, "transaction");
        assert!(!pending[0].transcript_preview.is_empty());
        let confirmed = list_ai_proposals_at(
            &connection,
            "vault-1",
            ListAiProposalsRequest {
                status: Some("confirmed".to_owned()),
                limit: Some(10),
            },
        )
        .expect("confirmed inbox should list");
        assert!(confirmed.is_empty());
        let ledger_count: i64 = connection
            .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
            .expect("ledger should remain readable");
        assert_eq!(ledger_count, 0);
    }
}
