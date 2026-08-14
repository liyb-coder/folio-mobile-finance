use crate::{
    keychain,
    transactions::{
        create_sourced_transaction_draft, CreateTransactionDraftRequest, TransactionDraftResponse,
    },
    vault::VaultRuntime,
};
use getrandom::fill;
use mail_parser::decoders::html::html_to_text;
use mail_parser::MessageParser;
use native_tls::TlsConnector;
use regex::Regex;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::OnceLock};
use zeroize::Zeroizing;

const QQ_IMAP_HOST: &str = "imap.qq.com";
const QQ_IMAP_PORT: u16 = 993;
const MAX_MESSAGES_PER_SYNC: usize = 50;
const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const PARSER_VERSION: &str = "folio-qq-credit-card-email-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureEmailSourceRequest {
    email_address: String,
    authorization_code: String,
    account_id: String,
    mailbox: Option<String>,
    allowed_senders: Vec<String>,
    subject_keywords: Vec<String>,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSourceRequest {
    source_id: String,
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSourceStatus {
    id: String,
    provider: &'static str,
    email_address_masked: String,
    account_id: String,
    account_name: String,
    mailbox: String,
    allowed_senders: Vec<String>,
    subject_keywords: Vec<String>,
    last_uid: u32,
    enabled: bool,
    credential_stored: bool,
    pending_count: usize,
    quarantined_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailConnectionTestResponse {
    source_id: String,
    connected: bool,
    mailbox: String,
    exists: u32,
    read_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDraftItem {
    receipt_id: String,
    remote_uid: u32,
    item_index: usize,
    draft: TransactionDraftResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSyncResponse {
    source_id: String,
    examined_count: usize,
    matched_count: usize,
    created_draft_count: usize,
    duplicate_count: usize,
    quarantined_count: usize,
    last_uid: u32,
    drafts: Vec<EmailDraftItem>,
}

#[derive(Clone, Debug)]
struct EmailSourceConfig {
    id: String,
    email_address: String,
    account_id: String,
    mailbox: String,
    allowed_senders: Vec<String>,
    subject_keywords: Vec<String>,
    last_uid: u32,
}

#[derive(Clone, Debug)]
struct FetchedMessage {
    uid: u32,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
struct ParsedEmailTransaction {
    transaction_kind: &'static str,
    amount: String,
    occurred_on: String,
    description: String,
    card_suffix: Option<String>,
}

#[derive(Clone, Debug)]
struct ParsedCreditCardEmail {
    sender: String,
    sender_domain: String,
    subject: String,
    received_at: Option<String>,
    fingerprint: String,
    transactions: Vec<ParsedEmailTransaction>,
}

fn random_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).map_err(|_| "Unable to create a secure record identifier.".to_owned())?;
    Ok(format!("{prefix}_{}", hex::encode(bytes)))
}

fn required_text(value: String, field: &str, maximum: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.chars().count() > maximum {
        return Err(format!("{field} must contain 1 to {maximum} characters."));
    }
    Ok(normalized.to_owned())
}

fn normalize_email(value: String) -> Result<String, String> {
    let value = required_text(value, "Email address", 160)?.to_ascii_lowercase();
    let mut parts = value.split('@');
    if parts.next().is_none_or(str::is_empty)
        || parts.next().is_none_or(str::is_empty)
        || parts.next().is_some()
    {
        return Err("Email address is invalid.".to_owned());
    }
    Ok(value)
}

fn normalize_mailbox(value: Option<String>) -> Result<String, String> {
    let mailbox = value.unwrap_or_else(|| "INBOX".to_owned());
    let mailbox = required_text(mailbox, "Mailbox", 80)?;
    if mailbox.bytes().any(|byte| byte.is_ascii_control()) {
        return Err("Mailbox contains unsupported control characters.".to_owned());
    }
    Ok(mailbox)
}

fn normalize_rules(values: Vec<String>, field: &str) -> Result<Vec<String>, String> {
    if values.is_empty() || values.len() > 20 {
        return Err(format!("{field} must contain 1 to 20 entries."));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = required_text(value, field, 120)?.to_ascii_lowercase();
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    Ok(normalized)
}

fn validate_authorization_code(value: String) -> Result<Zeroizing<String>, String> {
    let normalized = value.trim();
    if normalized.len() < 8 || normalized.len() > 128 || normalized.contains(char::is_whitespace) {
        return Err("QQ Mail authorization code is invalid.".to_owned());
    }
    Ok(Zeroizing::new(normalized.to_owned()))
}

fn mask_email(value: &str) -> String {
    let Some((local, domain)) = value.split_once('@') else {
        return "***".to_owned();
    };
    let prefix: String = local.chars().take(2).collect();
    format!("{prefix}***@{domain}")
}

fn sender_domain(sender: &str) -> String {
    sender
        .rsplit_once('@')
        .map(|(_, domain)| domain.trim_matches(&['>', ' '][..]).to_ascii_lowercase())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn sender_allowed(sender: &str, rules: &[String]) -> bool {
    let sender = sender
        .trim()
        .trim_matches(&['<', '>'][..])
        .to_ascii_lowercase();
    let domain = sender_domain(&sender);
    rules.iter().any(|rule| {
        let rule = rule.trim_start_matches('@');
        sender == rule || domain == rule || sender.ends_with(&format!("@{rule}"))
    })
}

fn subject_allowed(subject: &str, keywords: &[String]) -> bool {
    let subject = subject.to_ascii_lowercase();
    keywords.iter().any(|keyword| subject.contains(keyword))
}

fn amount_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:交易金额|消费金额|入账金额|退款金额|金额|amount)\s*[:：]?\s*(?:人民币|RMB|CNY|￥|¥)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})|[0-9]+(?:\.[0-9]{1,2})?)",
        )
        .expect("amount regex should compile")
    })
}

fn date_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r"(?:交易时间|消费时间|入账时间|退款时间|交易日期|日期)\s*[:：]?\s*(20[0-9]{2})[-年/](1[0-2]|0?[1-9])[-月/](3[01]|[12][0-9]|0?[1-9])(?:日)?",
        )
        .expect("date regex should compile")
    })
}

fn merchant_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(r"(?:商户名称|交易商户|消费商户|商户|摘要|交易描述)\s*[:：]\s*([^\r\n<]{1,80})")
            .expect("merchant regex should compile")
    })
}

fn card_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(r"(?:尾号|末四位|卡号尾号)\s*[:：]?\s*(?:为)?\s*([0-9]{4})")
            .expect("card regex should compile")
    })
}

fn normalize_amount(value: &str) -> Option<String> {
    let value = value.replace(',', "");
    let mut parts = value.split('.');
    let major = parts.next()?;
    let fraction = parts.next();
    if parts.next().is_some() || major.parse::<u64>().ok()? == 0 && fraction.unwrap_or("0") == "0" {
        return None;
    }
    let fraction = match fraction.unwrap_or_default() {
        "" => "00".to_owned(),
        one if one.len() == 1 => format!("{one}0"),
        two => two.to_owned(),
    };
    Some(format!("{major}.{fraction}"))
}

fn parse_date(segment: &str) -> Option<String> {
    let capture = date_regex().captures(segment)?;
    let year = capture.get(1)?.as_str();
    let month: u8 = capture.get(2)?.as_str().parse().ok()?;
    let day: u8 = capture.get(3)?.as_str().parse().ok()?;
    let candidate = format!("{year}-{month:02}-{day:02}");
    chrono::NaiveDate::parse_from_str(&candidate, "%Y-%m-%d")
        .ok()
        .map(|_| candidate)
}

fn plain_body(message: &mail_parser::Message<'_>) -> String {
    let mut body = String::new();
    for index in 0..message.text_body_count() {
        if let Some(text) = message.body_text(index) {
            body.push_str(text.as_ref());
            body.push('\n');
        }
    }
    if body.trim().is_empty() {
        for index in 0..message.html_body_count() {
            if let Some(html) = message.body_html(index) {
                body.push_str(&html_to_text(html.as_ref()));
                body.push('\n');
            }
        }
    }
    body
}

fn parse_credit_card_email(bytes: &[u8]) -> Result<ParsedCreditCardEmail, String> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE_BYTES {
        return Err("message_size".to_owned());
    }
    let message = MessageParser::default()
        .parse(bytes)
        .ok_or_else(|| "mime_parse".to_owned())?;
    let sender = message
        .from()
        .and_then(|addresses| addresses.first())
        .and_then(|address| address.address())
        .map(str::to_owned)
        .ok_or_else(|| "missing_sender".to_owned())?;
    let subject = message
        .subject()
        .map(str::to_owned)
        .ok_or_else(|| "missing_subject".to_owned())?;
    let body = plain_body(&message);
    if body.trim().is_empty() {
        return Err("missing_body".to_owned());
    }
    let amount_matches: Vec<_> = amount_regex().captures_iter(&body).collect();
    if amount_matches.is_empty() {
        return Err("missing_amount".to_owned());
    }
    let mut transactions = Vec::new();
    let mut previous_end = 0;
    for capture in amount_matches {
        let whole = capture.get(0).ok_or_else(|| "amount_parse".to_owned())?;
        let raw_amount = capture.get(1).ok_or_else(|| "amount_parse".to_owned())?;
        let segment = &body[previous_end..whole.end()];
        previous_end = whole.end();
        let amount =
            normalize_amount(raw_amount.as_str()).ok_or_else(|| "invalid_amount".to_owned())?;
        let occurred_on = parse_date(segment).ok_or_else(|| "missing_date".to_owned())?;
        let description = merchant_regex()
            .captures(segment)
            .and_then(|value| value.get(1))
            .map(|value| value.as_str().trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "信用卡邮件消费".to_owned());
        let card_suffix = card_regex()
            .captures(segment)
            .and_then(|value| value.get(1))
            .map(|value| value.as_str().to_owned());
        let lower = segment.to_ascii_lowercase();
        let transaction_kind = if lower.contains("退款") || lower.contains("退货") {
            "income"
        } else {
            "expense"
        };
        transactions.push(ParsedEmailTransaction {
            transaction_kind,
            amount,
            occurred_on,
            description,
            card_suffix,
        });
    }
    let fingerprint = hex::encode(Sha256::digest(bytes));
    Ok(ParsedCreditCardEmail {
        sender_domain: sender_domain(&sender),
        sender,
        subject,
        received_at: None,
        fingerprint,
        transactions,
    })
}

fn parse_sender_and_subject(bytes: &[u8]) -> Result<(String, String), String> {
    let message = MessageParser::default()
        .parse(bytes)
        .ok_or_else(|| "mime_header_parse".to_owned())?;
    let sender = message
        .from()
        .and_then(|addresses| addresses.first())
        .and_then(|address| address.address())
        .map(str::to_owned)
        .ok_or_else(|| "missing_sender".to_owned())?;
    let subject = message
        .subject()
        .map(str::to_owned)
        .ok_or_else(|| "missing_subject".to_owned())?;
    Ok((sender, subject))
}

fn load_source(
    runtime: &VaultRuntime,
    source_id: &str,
) -> Result<(String, EmailSourceConfig), String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String, String, String, String, String, i64)> = connection
            .query_row(
                "SELECT id, email_address, account_id, mailbox, allowed_senders_json,
                        subject_keywords_json, last_uid
                 FROM email_sources
                 WHERE id = ?1 AND vault_id = ?2 AND enabled = 1",
                params![source_id, vault_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "Unable to read the encrypted email source.".to_owned())?;
        let Some((id, email_address, account_id, mailbox, senders, keywords, last_uid)) = row
        else {
            return Err("The email source does not exist or is disabled.".to_owned());
        };
        Ok((
            vault_id.to_owned(),
            EmailSourceConfig {
                id,
                email_address,
                account_id,
                mailbox,
                allowed_senders: serde_json::from_str(&senders)
                    .map_err(|_| "Email sender rules are damaged.".to_owned())?,
                subject_keywords: serde_json::from_str(&keywords)
                    .map_err(|_| "Email subject rules are damaged.".to_owned())?,
                last_uid: u32::try_from(last_uid)
                    .map_err(|_| "Email UID cursor is invalid.".to_owned())?,
            },
        ))
    })
}

fn connect_read_only(
    config: &EmailSourceConfig,
    authorization_code: &str,
) -> Result<
    (
        imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
        u32,
    ),
    String,
> {
    let tls = TlsConnector::builder()
        .build()
        .map_err(|_| "Unable to initialize secure mailbox transport.".to_owned())?;
    let client = imap::connect((QQ_IMAP_HOST, QQ_IMAP_PORT), QQ_IMAP_HOST, &tls)
        .map_err(|_| "Unable to reach QQ Mail over IMAPS.".to_owned())?;
    let mut session = client
        .login(&config.email_address, authorization_code)
        .map_err(|_| "QQ Mail rejected the email address or authorization code.".to_owned())?;
    let mailbox = session
        .examine(&config.mailbox)
        .map_err(|_| "Unable to open the configured mailbox in read-only mode.".to_owned())?;
    Ok((session, mailbox.exists))
}

fn fetch_new_messages(
    config: &EmailSourceConfig,
    authorization_code: &str,
) -> Result<(usize, u32, Vec<FetchedMessage>), String> {
    let (mut session, _) = connect_read_only(config, authorization_code)?;
    let start = config.last_uid.saturating_add(1).max(1);
    let sequence = format!("UID {start}:*");
    let uids = session
        .uid_search(sequence)
        .map_err(|_| "Unable to search new QQ Mail messages.".to_owned())?;
    let mut uids: Vec<u32> = uids.into_iter().collect();
    uids.sort_unstable();
    uids.truncate(MAX_MESSAGES_PER_SYNC);
    let examined_count = uids.len();
    let highest_examined_uid = uids.last().copied().unwrap_or(config.last_uid);
    let mut messages = Vec::new();
    for uid in uids {
        let headers = session
            .uid_fetch(
                uid.to_string(),
                "(UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])",
            )
            .map_err(|_| "Unable to fetch QQ Mail headers.".to_owned())?;
        let Some(header) = headers.iter().next().and_then(|fetch| fetch.header()) else {
            continue;
        };
        let Ok((sender, subject)) = parse_sender_and_subject(header) else {
            continue;
        };
        if !sender_allowed(&sender, &config.allowed_senders)
            || !subject_allowed(&subject, &config.subject_keywords)
        {
            continue;
        }
        let fetches = session
            .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
            .map_err(|_| "Unable to fetch a filtered QQ Mail message.".to_owned())?;
        let Some(fetch) = fetches.iter().next() else {
            continue;
        };
        let Some(body) = fetch.body() else {
            continue;
        };
        if body.len() <= MAX_MESSAGE_BYTES {
            messages.push(FetchedMessage {
                uid,
                bytes: body.to_vec(),
            });
        }
    }
    let _ = session.logout();
    Ok((examined_count, highest_examined_uid, messages))
}

fn read_only_connection_test(
    config: &EmailSourceConfig,
    authorization_code: &str,
) -> Result<EmailConnectionTestResponse, String> {
    let (mut session, exists) = connect_read_only(config, authorization_code)?;
    let _ = session.logout();
    Ok(EmailConnectionTestResponse {
        source_id: config.id.clone(),
        connected: true,
        mailbox: config.mailbox.clone(),
        exists,
        read_only: true,
    })
}

#[tauri::command]
pub fn email_source_configure(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfigureEmailSourceRequest,
) -> Result<EmailSourceStatus, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let email_address = normalize_email(request.email_address)?;
    if !email_address.ends_with("@qq.com") && !email_address.ends_with("@foxmail.com") {
        return Err(
            "This connector currently supports QQ Mail and Foxmail accounts only.".to_owned(),
        );
    }
    let authorization_code = validate_authorization_code(request.authorization_code)?;
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    let mailbox = normalize_mailbox(request.mailbox)?;
    let allowed_senders = normalize_rules(request.allowed_senders, "Allowed sender")?;
    let subject_keywords = normalize_rules(request.subject_keywords, "Subject keyword")?;
    let source_id = runtime.with_unlocked_connection(|vault_id, connection| {
        let account_exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM accounts
                   WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL
                 )",
                params![account_id, vault_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to validate the credit-card account.".to_owned())?;
        if !account_exists {
            return Err("The selected credit-card account does not exist.".to_owned());
        }
        let existing: Option<String> = connection
            .query_row(
                "SELECT id FROM email_sources
                 WHERE vault_id = ?1 AND provider = 'qq_imap' AND email_address = ?2",
                params![vault_id, email_address],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to inspect the encrypted email source.".to_owned())?;
        let source_id = existing.unwrap_or(random_id("email_source")?);
        connection
            .execute(
                "INSERT INTO email_sources(
                   id, vault_id, provider, email_address, host, port, mailbox,
                   account_id, allowed_senders_json, subject_keywords_json,
                   last_uid, enabled, created_at, updated_at
                 ) VALUES (
                   ?1, ?2, 'qq_imap', ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                   0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )
                 ON CONFLICT(vault_id, provider, email_address) DO UPDATE SET
                   mailbox = excluded.mailbox,
                   account_id = excluded.account_id,
                   allowed_senders_json = excluded.allowed_senders_json,
                   subject_keywords_json = excluded.subject_keywords_json,
                   enabled = 1,
                   updated_at = excluded.updated_at",
                params![
                    source_id,
                    vault_id,
                    email_address,
                    QQ_IMAP_HOST,
                    QQ_IMAP_PORT,
                    mailbox,
                    account_id,
                    serde_json::to_string(&allowed_senders)
                        .map_err(|_| "Unable to encode sender rules.".to_owned())?,
                    serde_json::to_string(&subject_keywords)
                        .map_err(|_| "Unable to encode subject rules.".to_owned())?,
                ],
            )
            .map_err(|_| "Unable to save the encrypted email source.".to_owned())?;
        Ok((vault_id.to_owned(), source_id))
    })?;
    if let Err(error) =
        keychain::store_email_secret(&source_id.0, &source_id.1, authorization_code.as_bytes())
    {
        let _ = runtime.with_unlocked_connection(|vault_id, connection| {
            connection
                .execute(
                    "UPDATE email_sources SET enabled = 0
                     WHERE id = ?1 AND vault_id = ?2",
                    params![source_id.1, vault_id],
                )
                .map_err(|_| "Unable to roll back the email source.".to_owned())?;
            Ok(())
        });
        return Err(error);
    }
    email_source_status_for(&runtime, &source_id.1)
}

fn email_source_status_for(
    runtime: &VaultRuntime,
    source_id: &str,
) -> Result<EmailSourceStatus, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(
            String,
            String,
            String,
            String,
            String,
            String,
            i64,
            bool,
            String,
        )> = connection
            .query_row(
                "SELECT s.id, s.email_address, s.account_id, a.display_name, s.mailbox,
                            s.allowed_senders_json, s.last_uid, s.enabled,
                            s.subject_keywords_json
                     FROM email_sources s
                     JOIN accounts a ON a.id = s.account_id
                     WHERE s.id = ?1 AND s.vault_id = ?2",
                params![source_id, vault_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "Unable to read the email source status.".to_owned())?;
        let Some((
            id,
            email_address,
            account_id,
            account_name,
            mailbox,
            senders,
            last_uid,
            enabled,
            keywords,
        )) = row
        else {
            return Err("The email source does not exist.".to_owned());
        };
        let pending_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM email_receipts
                 WHERE source_id = ?1 AND status = 'needs_review'",
                [&id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to count pending email records.".to_owned())?;
        let quarantined_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM email_receipts
                 WHERE source_id = ?1 AND status = 'quarantined'",
                [&id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to count quarantined email records.".to_owned())?;
        Ok(EmailSourceStatus {
            credential_stored: keychain::load_email_secret(vault_id, &id).is_ok(),
            id,
            provider: "qq_imap",
            email_address_masked: mask_email(&email_address),
            account_id,
            account_name,
            mailbox,
            allowed_senders: serde_json::from_str(&senders)
                .map_err(|_| "Email sender rules are damaged.".to_owned())?,
            subject_keywords: serde_json::from_str(&keywords)
                .map_err(|_| "Email subject rules are damaged.".to_owned())?,
            last_uid: u32::try_from(last_uid)
                .map_err(|_| "Email UID cursor is invalid.".to_owned())?,
            enabled,
            pending_count: usize::try_from(pending_count).unwrap_or_default(),
            quarantined_count: usize::try_from(quarantined_count).unwrap_or_default(),
        })
    })
}

#[tauri::command]
pub fn email_source_list(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<Vec<EmailSourceStatus>, String> {
    let ids = runtime.with_unlocked_connection(|vault_id, connection| {
        let mut statement = connection
            .prepare("SELECT id FROM email_sources WHERE vault_id = ?1 ORDER BY created_at, id")
            .map_err(|_| "Unable to list encrypted email sources.".to_owned())?;
        let rows = statement
            .query_map([vault_id], |row| row.get::<_, String>(0))
            .map_err(|_| "Unable to read encrypted email sources.".to_owned())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Unable to decode encrypted email sources.".to_owned())
    })?;
    ids.iter()
        .map(|id| email_source_status_for(&runtime, id))
        .collect()
}

#[tauri::command]
pub fn email_source_remove(
    runtime: tauri::State<'_, VaultRuntime>,
    request: EmailSourceRequest,
) -> Result<(), String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let source_id = required_text(request.source_id, "Email source identifier", 96)?;
    let vault_id = runtime.with_unlocked_connection(|vault_id, connection| {
        connection
            .execute(
                "UPDATE email_sources
                 SET enabled = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1 AND vault_id = ?2",
                params![source_id, vault_id],
            )
            .map_err(|_| "Unable to disable the email source.".to_owned())?;
        Ok(vault_id.to_owned())
    })?;
    keychain::delete_email_secret(&vault_id, &source_id);
    Ok(())
}

#[tauri::command]
pub async fn email_source_test(
    runtime: tauri::State<'_, VaultRuntime>,
    request: EmailSourceRequest,
) -> Result<EmailConnectionTestResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required before contacting QQ Mail.".to_owned());
    }
    let source_id = required_text(request.source_id, "Email source identifier", 96)?;
    let runtime = runtime.inner().clone();
    let (vault_id, config) = load_source(&runtime, &source_id)?;
    let secret = keychain::load_email_secret(&vault_id, &source_id)?;
    let secret = Zeroizing::new(
        String::from_utf8(secret.to_vec())
            .map_err(|_| "Stored mailbox authorization code is invalid.".to_owned())?,
    );
    tauri::async_runtime::spawn_blocking(move || read_only_connection_test(&config, &secret))
        .await
        .map_err(|_| "Mailbox connection test stopped unexpectedly.".to_owned())?
}

fn persist_messages(
    runtime: &VaultRuntime,
    config: &EmailSourceConfig,
    examined_count: usize,
    highest_examined_uid: u32,
    messages: Vec<FetchedMessage>,
) -> Result<EmailSyncResponse, String> {
    let mut matched_count = 0;
    let mut duplicate_count = 0;
    let mut quarantined_count = 0;
    let mut drafts = Vec::new();
    let mut highest_uid = config.last_uid.max(highest_examined_uid);
    for fetched in messages {
        highest_uid = highest_uid.max(fetched.uid);
        let parsed = match parse_credit_card_email(&fetched.bytes) {
            Ok(parsed) => parsed,
            Err(error_code) => {
                runtime.with_unlocked_connection(|vault_id, connection| {
                    connection
                        .execute(
                            "INSERT OR IGNORE INTO email_receipts(
                               id, vault_id, source_id, remote_uid, message_fingerprint,
                               sender_domain, received_at, status, error_code, created_at
                             ) VALUES (
                               ?1, ?2, ?3, ?4, ?5, 'unknown', NULL, 'quarantined', ?6,
                               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                             )",
                            params![
                                random_id("email_receipt")?,
                                vault_id,
                                config.id,
                                fetched.uid,
                                hex::encode(Sha256::digest(&fetched.bytes)),
                                error_code
                            ],
                        )
                        .map_err(|_| "Unable to quarantine an email record.".to_owned())?;
                    Ok(())
                })?;
                quarantined_count += 1;
                continue;
            }
        };
        if !sender_allowed(&parsed.sender, &config.allowed_senders)
            || !subject_allowed(&parsed.subject, &config.subject_keywords)
        {
            continue;
        }
        matched_count += 1;
        let existing = runtime.with_unlocked_connection(|vault_id, connection| {
            connection
                .query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM email_receipts
                       WHERE vault_id = ?1 AND message_fingerprint = ?2
                     )",
                    params![vault_id, parsed.fingerprint],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|_| "Unable to check email duplication.".to_owned())
        })?;
        if existing {
            duplicate_count += 1;
            continue;
        }
        let receipt_id = random_id("email_receipt")?;
        let created = runtime.with_unlocked_connection(|vault_id, connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| "Unable to begin the email ingestion transaction.".to_owned())?;
            transaction
                .execute(
                    "INSERT INTO email_receipts(
                       id, vault_id, source_id, remote_uid, message_fingerprint,
                       sender_domain, received_at, status, error_code, created_at
                     ) VALUES (
                       ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'needs_review', NULL,
                       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     )",
                    params![
                        receipt_id,
                        vault_id,
                        config.id,
                        fetched.uid,
                        parsed.fingerprint,
                        parsed.sender_domain,
                        parsed.received_at
                    ],
                )
                .map_err(|_| "Unable to save the email receipt fingerprint.".to_owned())?;
            let mut created = Vec::new();
            for (index, item) in parsed.transactions.iter().enumerate() {
                let evidence = json!([{
                    "source": "qq_imap",
                    "parserVersion": PARSER_VERSION,
                    "messageFingerprint": parsed.fingerprint,
                    "remoteUid": fetched.uid,
                    "itemIndex": index,
                    "senderDomain": parsed.sender_domain,
                    "subjectMatched": true,
                    "reviewRequired": true,
                    "rawMessagePersisted": false
                }])
                .to_string();
                let notes = item
                    .card_suffix
                    .as_ref()
                    .map(|suffix| format!("QQ 邮箱信用卡通知 · 卡尾号 {suffix} · 待人工核对"));
                let draft = create_sourced_transaction_draft(
                    &transaction,
                    vault_id,
                    CreateTransactionDraftRequest {
                        transaction_kind: item.transaction_kind.to_owned(),
                        account_id: config.account_id.clone(),
                        destination_account_id: None,
                        amount: item.amount.clone(),
                        occurred_on: item.occurred_on.clone(),
                        description: item.description.clone(),
                        category: Some(
                            if item.transaction_kind == "income" {
                                "退款"
                            } else {
                                "信用卡消费"
                            }
                            .to_owned(),
                        ),
                        notes,
                    },
                    "email_transaction",
                    Some(&format!("{}:{index}", parsed.fingerprint)),
                    evidence,
                )?;
                transaction
                    .execute(
                        "INSERT INTO email_receipt_items(
                           id, receipt_id, item_index, transaction_draft_id, created_at
                         ) VALUES (
                           ?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                         )",
                        params![
                            random_id("email_item")?,
                            receipt_id,
                            i64::try_from(index)
                                .map_err(|_| "Email item index is invalid.".to_owned())?,
                            draft.draft_id
                        ],
                    )
                    .map_err(|_| "Unable to link the email item to its review draft.".to_owned())?;
                created.push(EmailDraftItem {
                    receipt_id: receipt_id.clone(),
                    remote_uid: fetched.uid,
                    item_index: index,
                    draft,
                });
            }
            transaction
                .commit()
                .map_err(|_| "Unable to commit email review drafts atomically.".to_owned())?;
            Ok(created)
        })?;
        drafts.extend(created);
    }
    runtime.with_unlocked_connection(|vault_id, connection| {
        connection
            .execute(
                "UPDATE email_sources
                 SET last_uid = MAX(last_uid, ?1),
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?2 AND vault_id = ?3",
                params![highest_uid, config.id, vault_id],
            )
            .map_err(|_| "Unable to save the email UID cursor.".to_owned())?;
        Ok(())
    })?;
    Ok(EmailSyncResponse {
        source_id: config.id.clone(),
        examined_count,
        matched_count,
        created_draft_count: drafts.len(),
        duplicate_count,
        quarantined_count,
        last_uid: highest_uid,
        drafts,
    })
}

#[tauri::command]
pub async fn email_source_sync(
    runtime: tauri::State<'_, VaultRuntime>,
    request: EmailSourceRequest,
) -> Result<EmailSyncResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required before reading QQ Mail.".to_owned());
    }
    let source_id = required_text(request.source_id, "Email source identifier", 96)?;
    let runtime = runtime.inner().clone();
    let (vault_id, config) = load_source(&runtime, &source_id)?;
    let secret = keychain::load_email_secret(&vault_id, &source_id)?;
    let secret = Zeroizing::new(
        String::from_utf8(secret.to_vec())
            .map_err(|_| "Stored mailbox authorization code is invalid.".to_owned())?,
    );
    let fetch_config = config.clone();
    let (examined_count, highest_examined_uid, messages) =
        tauri::async_runtime::spawn_blocking(move || fetch_new_messages(&fetch_config, &secret))
            .await
            .map_err(|_| "Mailbox synchronization stopped unexpectedly.".to_owned())??;
    persist_messages(
        &runtime,
        &config,
        examined_count,
        highest_examined_uid,
        messages,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::open_encrypted,
        transactions::{confirm_transaction_draft_at, ConfirmTransactionDraftRequest},
    };
    use rusqlite::params;
    use tempfile::tempdir;

    fn message(body: &str, subject: &str, sender: &str) -> Vec<u8> {
        format!(
            "From: 招商银行 <{sender}>\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n{body}"
        )
        .into_bytes()
    }

    fn html_message(body: &str, subject: &str, sender: &str) -> Vec<u8> {
        format!(
            "From: 招商银行 <{sender}>\r\nSubject: {subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n{body}"
        )
        .into_bytes()
    }

    #[test]
    fn parses_multiple_credit_card_transactions_without_rounding() {
        let bytes = message(
            "交易日期：2026-07-28\n商户名称：盒马鲜生\n交易金额：人民币 128.35\n\
             交易日期：2026/07/29\n交易商户：滴滴出行\n消费金额：¥46.80",
            "信用卡每日消费提醒",
            "notice@cmbchina.com",
        );
        let parsed = parse_credit_card_email(&bytes).expect("email should parse");
        assert_eq!(parsed.sender, "notice@cmbchina.com");
        assert_eq!(parsed.transactions.len(), 2);
        assert_eq!(parsed.transactions[0].amount, "128.35");
        assert_eq!(parsed.transactions[0].occurred_on, "2026-07-28");
        assert_eq!(parsed.transactions[0].description, "盒马鲜生");
        assert_eq!(parsed.transactions[1].amount, "46.80");
        assert_eq!(parsed.transactions[1].occurred_on, "2026-07-29");
    }

    #[test]
    fn detects_refund_as_income() {
        let bytes = message(
            "退款时间：2026年7月30日\n交易商户：某电商\n退款金额：CNY 19.90",
            "信用卡退款入账提醒",
            "notice@cmbchina.com",
        );
        let parsed = parse_credit_card_email(&bytes).expect("refund should parse");
        assert_eq!(parsed.transactions[0].transaction_kind, "income");
        assert_eq!(parsed.transactions[0].amount, "19.90");
    }

    #[test]
    fn parses_html_only_bank_notification() {
        let bytes = html_message(
            "<table><tr><td>交易日期：</td><td>2026-07-30</td></tr>\
             <tr><td>商户名称：</td><td>虚构咖啡店</td></tr>\
             <tr><td>交易金额：</td><td>人民币 28.60</td></tr></table>",
            "信用卡消费提醒",
            "notice@cmbchina.com",
        );
        let parsed = parse_credit_card_email(&bytes).expect("HTML email should parse");
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.transactions[0].amount, "28.60");
        assert_eq!(parsed.transactions[0].occurred_on, "2026-07-30");
    }

    #[test]
    fn fails_closed_when_amount_or_date_is_missing() {
        let bytes = message(
            "商户名称：未知商户\n交易金额：128.35",
            "信用卡消费提醒",
            "notice@cmbchina.com",
        );
        assert_eq!(parse_credit_card_email(&bytes).unwrap_err(), "missing_date");
    }

    #[test]
    fn applies_exact_sender_and_subject_filters() {
        assert!(sender_allowed(
            "notice@cmbchina.com",
            &["cmbchina.com".to_owned()]
        ));
        assert!(!sender_allowed(
            "notice@cmbchina.com.attacker.example",
            &["cmbchina.com".to_owned()]
        ));
        assert!(subject_allowed(
            "信用卡每日消费提醒",
            &["消费提醒".to_owned()]
        ));
    }

    #[test]
    fn masks_mailbox_identity() {
        assert_eq!(mask_email("beizi@qq.com"), "be***@qq.com");
    }

    #[test]
    fn encrypted_ingestion_creates_review_drafts_before_any_ledger_write() {
        let directory = tempdir().expect("temp directory should exist");
        let path = directory.path().join("email-e2e.db");
        let connection = open_encrypted(&path, &[19_u8; 32]).expect("vault should open");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-email', '邮箱测试', 'CNY', '2026-07-30T00:00:00.000Z')",
                [],
            )
            .expect("vault row should insert");
        connection
            .execute(
                "INSERT INTO accounts(
                   id, vault_id, institution_name, display_name, account_type,
                   currency, masked_identifier, notes, created_at
                 ) VALUES (
                   'card-account', 'vault-email', '招商银行', '信用卡',
                   'credit_card', 'CNY', '8899', NULL, '2026-07-30T00:00:00.000Z'
                 )",
                [],
            )
            .expect("account should insert");
        connection
            .execute(
                "INSERT INTO email_sources(
                   id, vault_id, provider, email_address, host, port, mailbox,
                   account_id, allowed_senders_json, subject_keywords_json,
                   last_uid, enabled, created_at, updated_at
                 ) VALUES (
                   'source-email', 'vault-email', 'qq_imap', 'demo@qq.com',
                   'imap.qq.com', 993, 'INBOX', 'card-account',
                   '[\"cmbchina.com\"]', '[\"消费提醒\"]', 0, 1,
                   '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'
                 )",
                [],
            )
            .expect("source should insert");
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-email", connection);
        let config = EmailSourceConfig {
            id: "source-email".to_owned(),
            email_address: "demo@qq.com".to_owned(),
            account_id: "card-account".to_owned(),
            mailbox: "INBOX".to_owned(),
            allowed_senders: vec!["cmbchina.com".to_owned()],
            subject_keywords: vec!["消费提醒".to_owned()],
            last_uid: 0,
        };
        let result = persist_messages(
            &runtime,
            &config,
            1,
            42,
            vec![FetchedMessage {
                uid: 42,
                bytes: message(
                    "交易日期：2026-07-28\n商户名称：盒马鲜生\n交易金额：人民币 128.35\n\
                     交易日期：2026-07-29\n交易商户：滴滴出行\n消费金额：¥46.80",
                    "信用卡每日消费提醒",
                    "notice@cmbchina.com",
                ),
            }],
        )
        .expect("message should create review drafts");
        assert_eq!(result.created_draft_count, 2);
        runtime
            .with_unlocked_connection(|_, connection| {
                let ledger_count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .map_err(|error| error.to_string())?;
                let draft_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM draft_changes
                         WHERE source_type = 'email_transaction' AND status = 'needs_review'",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                assert_eq!(ledger_count, 0);
                assert_eq!(draft_count, 2);
                Ok(())
            })
            .expect("review state should be readable");
        for item in result.drafts {
            confirm_transaction_draft_at(
                &runtime,
                ConfirmTransactionDraftRequest {
                    draft_id: item.draft.draft_id,
                    confirmed_by_user: true,
                },
            )
            .expect("explicit confirmation should append ledger event");
        }
        runtime
            .with_unlocked_connection(|_, connection| {
                let ledger_count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .map_err(|error| error.to_string())?;
                let net: i64 = connection
                    .query_row(
                        "SELECT COALESCE(sum(delta_minor), 0) FROM ledger_events",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                let receipt_items: i64 = connection
                    .query_row("SELECT count(*) FROM email_receipt_items", [], |row| {
                        row.get(0)
                    })
                    .map_err(|error| error.to_string())?;
                assert_eq!(ledger_count, 2);
                assert_eq!(net, -17_515);
                assert_eq!(receipt_items, 2);
                Ok(())
            })
            .expect("confirmed ledger should be readable");

        let duplicate = persist_messages(
            &runtime,
            &config,
            1,
            43,
            vec![FetchedMessage {
                uid: 43,
                bytes: message(
                    "交易日期：2026-07-28\n商户名称：盒马鲜生\n交易金额：人民币 128.35\n\
                     交易日期：2026-07-29\n交易商户：滴滴出行\n消费金额：¥46.80",
                    "信用卡每日消费提醒",
                    "notice@cmbchina.com",
                ),
            }],
        )
        .expect("duplicate scan should complete");
        assert_eq!(duplicate.duplicate_count, 1);
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM email_receipts WHERE source_id = ?1",
                        params![config.id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                assert_eq!(count, 1);
                Ok(())
            })
            .expect("dedupe state should be readable");
    }
}
