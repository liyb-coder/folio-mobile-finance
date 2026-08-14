use crate::{keychain, vault::VaultRuntime};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, time::Duration};
use zeroize::Zeroizing;

const OPENAI_PROVIDER_ID: &str = "openai_responses_v1";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL: &str = "gpt-5.6-terra";
const MAX_MODEL_INPUT_CHARS: usize = 40_000;
const MAX_API_KEY_BYTES: usize = 512;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderStatusResponse {
    provider_id: &'static str,
    configured: bool,
    credential_source: &'static str,
    model: String,
    base_url: String,
    data_boundary: &'static str,
    capabilities: Vec<&'static str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureModelProviderRequest {
    api_key: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveModelProviderRequest {
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestModelProviderRequest {
    allow_external: bool,
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestModelProviderResponse {
    status: &'static str,
    provider_id: &'static str,
    model: String,
    credential_source: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractFinancialFactsRequest {
    text: String,
    module_context: String,
    allow_external: bool,
    confirmed_by_user: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFinancialFact {
    kind: String,
    title: String,
    date: Option<String>,
    amount_text: Option<String>,
    currency: Option<String>,
    account_hint: Option<String>,
    details: String,
    confidence_bps: i64,
    evidence_quote: String,
    needs_review: bool,
    missing_fields: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractFinancialFactsResponse {
    #[serde(default)]
    provider_id: String,
    #[serde(default)]
    model: String,
    document_summary: String,
    records: Vec<ExtractedFinancialFact>,
    warnings: Vec<String>,
}

struct ProviderCredential {
    secret: Zeroizing<String>,
    source: &'static str,
}

fn validate_api_key(value: String) -> Result<Zeroizing<String>, String> {
    if value.chars().any(char::is_whitespace) {
        return Err("Model provider API key is invalid.".to_owned());
    }
    let value = Zeroizing::new(value.trim().to_owned());
    if value.len() < 20 || value.len() > MAX_API_KEY_BYTES {
        return Err("Model provider API key is invalid.".to_owned());
    }
    Ok(value)
}

fn environment_value(names: &[&str]) -> Option<Zeroizing<String>> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .and_then(|value| validate_api_key(value).ok())
    })
}

fn load_provider_credential() -> Result<ProviderCredential, String> {
    if let Some(secret) = environment_value(&[
        "FOLIO_LLM_API_KEY",
        "FOLIO_OPENAI_API_KEY",
        "OPENAI_API_KEY",
    ]) {
        return Ok(ProviderCredential {
            secret,
            source: "environment",
        });
    }
    let stored = keychain::load_model_secret(OPENAI_PROVIDER_ID)?;
    let decoded = String::from_utf8(stored.to_vec())
        .map_err(|_| "The stored model provider key is invalid.".to_owned())?;
    Ok(ProviderCredential {
        secret: validate_api_key(decoded)?,
        source: "keychain",
    })
}

fn configured_credential_source() -> &'static str {
    if environment_value(&[
        "FOLIO_LLM_API_KEY",
        "FOLIO_OPENAI_API_KEY",
        "OPENAI_API_KEY",
    ])
    .is_some()
    {
        "environment"
    } else if keychain::load_model_secret(OPENAI_PROVIDER_ID).is_ok() {
        "keychain"
    } else {
        "none"
    }
}

fn model_name() -> Result<String, String> {
    let value = env::var("FOLIO_LLM_MODEL")
        .ok()
        .or_else(|| env::var("FOLIO_OPENAI_MODEL").ok())
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_owned());
    let value = value.trim();
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("Configured OpenAI model name is invalid.".to_owned());
    }
    Ok(value.to_owned())
}

fn base_url() -> Result<String, String> {
    let value = env::var("FOLIO_LLM_BASE_URL")
        .ok()
        .or_else(|| env::var("FOLIO_OPENAI_BASE_URL").ok())
        .unwrap_or_else(|| DEFAULT_OPENAI_BASE_URL.to_owned());
    let value = value.trim().trim_end_matches('/');
    let is_secure = value.starts_with("https://");
    let is_local_debug = cfg!(debug_assertions)
        && (value.starts_with("http://127.0.0.1") || value.starts_with("http://localhost"));
    if value.len() > 240 || (!is_secure && !is_local_debug) {
        return Err("Configured OpenAI base URL is not allowed.".to_owned());
    }
    Ok(value.to_owned())
}

fn ensure_external_consent(allow_external: bool, confirmed_by_user: bool) -> Result<(), String> {
    if !allow_external || !confirmed_by_user {
        return Err(
            "External model use requires explicit confirmation for this request.".to_owned(),
        );
    }
    Ok(())
}

fn ensure_unlocked(runtime: &VaultRuntime) -> Result<(), String> {
    runtime.with_unlocked_connection(|_, _| Ok(()))
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "Unable to initialize the model provider client.".to_owned())
}

async fn send_response_request(
    credential: &ProviderCredential,
    payload: &Value,
) -> Result<Value, String> {
    let endpoint = format!("{}/responses", base_url()?);
    let response = http_client()?
        .post(endpoint)
        .bearer_auth(credential.secret.as_str())
        .json(payload)
        .send()
        .await
        .map_err(|_| "Unable to reach the configured model provider.".to_owned())?;
    let status = response.status();
    if !status.is_success() {
        let message = match status.as_u16() {
            401 => "The model provider rejected the API key.",
            403 => "The configured API key cannot access this model.",
            408 | 504 => "The model provider request timed out.",
            429 => "The model provider rate limit or budget was reached.",
            500..=599 => "The model provider is temporarily unavailable.",
            _ => "The model provider request was rejected.",
        };
        return Err(message.to_owned());
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| "The model provider returned an invalid response.".to_owned())
}

fn response_output_text(response: &Value) -> Result<String, String> {
    if let Some(text) = response.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_owned());
    }
    let output = response
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| "The model provider response contains no output.".to_owned())?;
    for item in output {
        if item.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        if let Some(content) = item.get("content").and_then(Value::as_array) {
            for part in content {
                match part.get("type").and_then(Value::as_str) {
                    Some("output_text") => {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            return Ok(text.to_owned());
                        }
                    }
                    Some("refusal") => {
                        return Err(
                            "The model provider declined this extraction request.".to_owned()
                        )
                    }
                    _ => {}
                }
            }
        }
    }
    Err("The model provider response contains no usable text.".to_owned())
}

fn extraction_schema() -> Value {
    json!({
        "type": "json_schema",
        "name": "folio_financial_facts",
        "strict": true,
        "schema": {
            "type": "object",
            "properties": {
                "documentSummary": { "type": "string" },
                "records": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": [
                                    "account", "holding", "transaction", "reminder",
                                    "planning", "insurance", "legal", "unknown"
                                ]
                            },
                            "title": { "type": "string" },
                            "date": { "type": ["string", "null"] },
                            "amountText": { "type": ["string", "null"] },
                            "currency": { "type": ["string", "null"] },
                            "accountHint": { "type": ["string", "null"] },
                            "details": { "type": "string" },
                            "confidenceBps": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 10000
                            },
                            "evidenceQuote": { "type": "string" },
                            "needsReview": { "type": "boolean" },
                            "missingFields": {
                                "type": "array",
                                "items": { "type": "string" }
                            }
                        },
                        "required": [
                            "kind", "title", "date", "amountText", "currency",
                            "accountHint", "details", "confidenceBps", "evidenceQuote",
                            "needsReview", "missingFields"
                        ],
                        "additionalProperties": false
                    }
                },
                "warnings": {
                    "type": "array",
                    "items": { "type": "string" }
                }
            },
            "required": ["documentSummary", "records", "warnings"],
            "additionalProperties": false
        }
    })
}

fn validate_module_context(value: String) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if ![
        "overview",
        "assets",
        "cashflow",
        "planning",
        "reminders",
        "assistant",
        "sources",
        "settings",
    ]
    .contains(&value.as_str())
    {
        return Err("Model extraction module context is unsupported.".to_owned());
    }
    Ok(value)
}

fn parse_extraction_output(
    response: Value,
    input: &str,
    model: String,
) -> Result<ExtractFinancialFactsResponse, String> {
    let output_text = response_output_text(&response)?;
    let mut parsed: ExtractFinancialFactsResponse = serde_json::from_str(&output_text)
        .map_err(|_| "The model provider output did not match the financial schema.".to_owned())?;
    if parsed.records.len() > 100 {
        return Err("The model provider returned too many financial records.".to_owned());
    }
    for record in &parsed.records {
        if record.evidence_quote.trim().is_empty() || !input.contains(&record.evidence_quote) {
            return Err(
                "A model-extracted record could not be verified against its source text."
                    .to_owned(),
            );
        }
        if !(0..=10_000).contains(&record.confidence_bps) {
            return Err("A model-extracted confidence score is invalid.".to_owned());
        }
    }
    parsed.provider_id = OPENAI_PROVIDER_ID.to_owned();
    parsed.model = model;
    Ok(parsed)
}

async fn extract_with_openai(
    credential: &ProviderCredential,
    text: &str,
    module_context: &str,
) -> Result<ExtractFinancialFactsResponse, String> {
    let model = model_name()?;
    let payload = json!({
        "model": model,
        "store": false,
        "reasoning": { "effort": "low" },
        "max_output_tokens": 8_000,
        "input": [
            {
                "role": "system",
                "content": concat!(
                    "Extract financial facts from the user's source text. ",
                    "Do not calculate, infer, or complete missing money values. ",
                    "Keep every amount in amountText exactly as written. ",
                    "evidenceQuote must be an exact contiguous quote from the source. ",
                    "Insurance and legal facts are informational records and never ledger writes. ",
                    "Every record requires human review before any domain draft or ledger update."
                )
            },
            {
                "role": "user",
                "content": format!("Module: {module_context}\n\nSource text:\n{text}")
            }
        ],
        "text": {
            "format": extraction_schema(),
            "verbosity": "low"
        }
    });
    let response = send_response_request(credential, &payload).await?;
    parse_extraction_output(response, text, model)
}

#[tauri::command]
pub async fn model_provider_status(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<ModelProviderStatusResponse, String> {
    ensure_unlocked(runtime.inner())?;
    let source = configured_credential_source();
    Ok(ModelProviderStatusResponse {
        provider_id: OPENAI_PROVIDER_ID,
        configured: source != "none",
        credential_source: source,
        model: model_name()?,
        base_url: base_url()?,
        data_boundary: "external",
        capabilities: vec!["connection_test", "extract_financial_facts"],
    })
}

#[tauri::command]
pub async fn model_provider_configure(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfigureModelProviderRequest,
) -> Result<ModelProviderStatusResponse, String> {
    ensure_unlocked(runtime.inner())?;
    if !request.confirmed_by_user {
        return Err("Saving a model provider key requires explicit confirmation.".to_owned());
    }
    let key = validate_api_key(request.api_key)?;
    keychain::store_model_secret(OPENAI_PROVIDER_ID, key.as_bytes())?;
    Ok(ModelProviderStatusResponse {
        provider_id: OPENAI_PROVIDER_ID,
        configured: true,
        credential_source: configured_credential_source(),
        model: model_name()?,
        base_url: base_url()?,
        data_boundary: "external",
        capabilities: vec!["connection_test", "extract_financial_facts"],
    })
}

#[tauri::command]
pub async fn model_provider_remove(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RemoveModelProviderRequest,
) -> Result<ModelProviderStatusResponse, String> {
    ensure_unlocked(runtime.inner())?;
    if !request.confirmed_by_user {
        return Err("Removing a model provider key requires explicit confirmation.".to_owned());
    }
    keychain::delete_model_secret(OPENAI_PROVIDER_ID);
    let source = configured_credential_source();
    Ok(ModelProviderStatusResponse {
        provider_id: OPENAI_PROVIDER_ID,
        configured: source != "none",
        credential_source: source,
        model: model_name()?,
        base_url: base_url()?,
        data_boundary: "external",
        capabilities: vec!["connection_test", "extract_financial_facts"],
    })
}

#[tauri::command]
pub async fn model_provider_test(
    runtime: tauri::State<'_, VaultRuntime>,
    request: TestModelProviderRequest,
) -> Result<TestModelProviderResponse, String> {
    ensure_unlocked(runtime.inner())?;
    ensure_external_consent(request.allow_external, request.confirmed_by_user)?;
    let credential = load_provider_credential()?;
    let model = model_name()?;
    let payload = json!({
        "model": model,
        "store": false,
        "reasoning": { "effort": "low" },
        "max_output_tokens": 64,
        "input": [
            {
                "role": "system",
                "content": "Return exactly FOLIO_OK and no other text."
            },
            {
                "role": "user",
                "content": "Folio model provider connection test."
            }
        ],
        "text": { "verbosity": "low" }
    });
    let response = send_response_request(&credential, &payload).await?;
    let output = response_output_text(&response)?;
    if output.trim() != "FOLIO_OK" {
        return Err("The model provider returned an unexpected connection result.".to_owned());
    }
    Ok(TestModelProviderResponse {
        status: "connected",
        provider_id: OPENAI_PROVIDER_ID,
        model,
        credential_source: credential.source,
    })
}

#[tauri::command]
pub async fn model_extract_financial_facts(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ExtractFinancialFactsRequest,
) -> Result<ExtractFinancialFactsResponse, String> {
    ensure_unlocked(runtime.inner())?;
    ensure_external_consent(request.allow_external, request.confirmed_by_user)?;
    let module_context = validate_module_context(request.module_context)?;
    let text = request.text.trim().to_owned();
    if text.is_empty() || text.chars().count() > MAX_MODEL_INPUT_CHARS {
        return Err("Model extraction text must contain 1 to 40000 characters.".to_owned());
    }
    let credential = load_provider_credential()?;
    extract_with_openai(&credential, &text, &module_context).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response_with_output(text: &str) -> Value {
        json!({
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": text
                }]
            }]
        })
    }

    #[test]
    fn provider_key_validation_rejects_short_or_multiline_secrets() {
        assert!(validate_api_key("short".to_owned()).is_err());
        assert!(validate_api_key(format!("sk-test-{}\n", "x".repeat(30))).is_err());
        assert!(validate_api_key(format!("sk-test-{}", "x".repeat(30))).is_ok());
    }

    #[test]
    fn extraction_output_requires_exact_source_evidence() {
        let valid = json!({
            "documentSummary": "一笔消费",
            "records": [{
                "kind": "transaction",
                "title": "日用品",
                "date": "2026-07-30",
                "amountText": "368.00元",
                "currency": "CNY",
                "accountHint": "建行",
                "details": "日用品消费",
                "confidenceBps": 9300,
                "evidenceQuote": "建行消费368.00元",
                "needsReview": true,
                "missingFields": []
            }],
            "warnings": []
        })
        .to_string();
        let parsed = parse_extraction_output(
            response_with_output(&valid),
            "2026-07-30 建行消费368.00元，购买日用品。",
            "gpt-test".to_owned(),
        )
        .expect("exact evidence should parse");
        assert_eq!(parsed.records.len(), 1);
        assert_eq!(parsed.provider_id, OPENAI_PROVIDER_ID);

        let invalid = valid.replace("建行消费368.00元", "模型编造的证据");
        assert!(parse_extraction_output(
            response_with_output(&invalid),
            "2026-07-30 建行消费368.00元，购买日用品。",
            "gpt-test".to_owned(),
        )
        .is_err());
    }

    #[test]
    fn external_model_calls_require_per_request_confirmation() {
        assert!(ensure_external_consent(false, true).is_err());
        assert!(ensure_external_consent(true, false).is_err());
        assert!(ensure_external_consent(true, true).is_ok());
    }

    #[test]
    fn generic_model_environment_names_are_declared() {
        let source = include_str!("model_gateway.rs");
        for name in [
            "FOLIO_LLM_API_KEY",
            "FOLIO_LLM_MODEL",
            "FOLIO_LLM_BASE_URL",
        ] {
            assert!(source.contains(name));
        }
    }

    #[test]
    #[ignore = "requires OPENAI_API_KEY and makes a paid network request"]
    fn live_openai_structured_extraction_uses_environment_key() {
        let credential =
            load_provider_credential().expect("a configured OpenAI credential is required");
        let result = tauri::async_runtime::block_on(extract_with_openai(
            &credential,
            "2026-07-30 建行消费368.00元，购买日用品。",
            "cashflow",
        ))
        .expect("live OpenAI extraction should succeed");
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].amount_text.as_deref(), Some("368.00元"));
        assert!(
            "2026-07-30 建行消费368.00元，购买日用品。".contains(&result.records[0].evidence_quote)
        );
    }
}
