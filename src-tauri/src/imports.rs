use crate::vault::VaultRuntime;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use calamine::{Data, Reader, Xlsx};
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Cursor};

const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 5_000;
const MAX_IMPORT_COLUMNS: usize = 64;
const MAX_CELL_CHARACTERS: usize = 1_000;
const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const PARSER_VERSION: &str = "folio-bank-import-v1";
const TABLE_PARSER_VERSION: &str = "folio-pasted-table-import-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectImportFileRequest {
    file_name: String,
    content_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumnMapping {
    date: String,
    amount: String,
    transaction_type: Option<String>,
    description: Option<String>,
    category: Option<String>,
    currency: Option<String>,
    external_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateImportDraftRequest {
    file_name: String,
    content_base64: String,
    account_id: String,
    mapping: ImportColumnMapping,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmImportDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectImportDraftRequest {
    draft_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedImportMapping {
    date: Option<String>,
    amount: Option<String>,
    transaction_type: Option<String>,
    description: Option<String>,
    category: Option<String>,
    currency: Option<String>,
    external_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectImportFileResponse {
    file_name: String,
    format: String,
    sheet_name: Option<String>,
    source_fingerprint: String,
    headers: Vec<String>,
    sample_rows: Vec<Vec<String>>,
    row_count: usize,
    suggested_mapping: SuggestedImportMapping,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowError {
    row: usize,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRow {
    row: usize,
    event_id: String,
    transaction_kind: String,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    description: String,
    category: Option<String>,
    external_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReconciliationReport {
    accepted_count: usize,
    error_count: usize,
    total_income_minor: i64,
    total_expense_minor: i64,
    net_change_minor: i64,
    currency: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportDraftPayload {
    kind: String,
    import_batch_id: String,
    source_name: String,
    source_format: String,
    source_fingerprint: String,
    parser_version: String,
    sheet_name: Option<String>,
    account_id: String,
    account_name: String,
    currency: String,
    mapping: ImportColumnMapping,
    rows: Vec<ImportPreviewRow>,
    errors: Vec<ImportRowError>,
    report: ImportReconciliationReport,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDraftResponse {
    draft_id: Option<String>,
    import_batch_id: String,
    source_name: String,
    source_format: String,
    source_fingerprint: String,
    sheet_name: Option<String>,
    account_id: String,
    account_name: String,
    currency: String,
    rows: Vec<ImportPreviewRow>,
    errors: Vec<ImportRowError>,
    report: ImportReconciliationReport,
    already_imported: bool,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfirmationResponse {
    draft_id: String,
    import_batch_id: String,
    report: ImportReconciliationReport,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRejectionResponse {
    draft_id: String,
    import_batch_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchSnapshot {
    id: String,
    source_type: String,
    source_name: String,
    source_fingerprint: String,
    parser_version: String,
    status: String,
    row_count: i64,
    error_count: i64,
    created_at: String,
    confirmed_at: Option<String>,
}

#[derive(Clone, Debug)]
struct ParsedTableRow {
    number: usize,
    cells: Vec<String>,
}

#[derive(Clone, Debug)]
struct ParsedTable {
    format: String,
    sheet_name: Option<String>,
    headers: Vec<String>,
    rows: Vec<ParsedTableRow>,
}

#[derive(Clone, Copy)]
struct ResolvedMapping {
    date: usize,
    amount: usize,
    transaction_type: Option<usize>,
    description: Option<usize>,
    category: Option<usize>,
    currency: Option<usize>,
    external_id: Option<usize>,
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

fn normalized_file_name(value: String) -> Result<String, String> {
    let name = required_text(value, "File name", 160)?;
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("File name must not contain a path.".to_owned());
    }
    Ok(name)
}

fn decode_file(file_name: String, content_base64: String) -> Result<(String, Vec<u8>), String> {
    let file_name = normalized_file_name(file_name)?;
    if content_base64.len() > (MAX_FILE_BYTES * 4 / 3) + 8 {
        return Err("Import file must not exceed 10 MB.".to_owned());
    }
    let bytes = STANDARD
        .decode(content_base64.trim())
        .map_err(|_| "Import file content is invalid.".to_owned())?;
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("Import file must contain 1 byte to 10 MB.".to_owned());
    }
    Ok((file_name, bytes))
}

fn source_fingerprint(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn normalize_cell(value: impl Into<String>) -> Result<String, String> {
    let value = value.into().trim().to_owned();
    if value.chars().count() > MAX_CELL_CHARACTERS {
        return Err("A spreadsheet cell exceeds the 1,000 character limit.".to_owned());
    }
    Ok(value)
}

fn validate_table(table: ParsedTable) -> Result<ParsedTable, String> {
    if table.headers.is_empty() || table.headers.len() > MAX_IMPORT_COLUMNS {
        return Err("Import file must contain 1 to 64 columns.".to_owned());
    }
    if table.rows.is_empty() {
        return Err("Import file must contain a header and at least one data row.".to_owned());
    }
    if table.rows.len() > MAX_IMPORT_ROWS {
        return Err("Import file must not exceed 5,000 data rows.".to_owned());
    }
    if table.headers.iter().any(|header| header.is_empty()) {
        return Err("Import file contains an empty column heading.".to_owned());
    }
    let mut normalized = table
        .headers
        .iter()
        .map(|header| header.trim().to_lowercase())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized.len() != table.headers.len() {
        return Err("Import file contains duplicate column headings.".to_owned());
    }
    Ok(table)
}

fn parse_delimited(
    bytes: &[u8],
    delimiter: u8,
    format: &str,
    label: &str,
) -> Result<ParsedTable, String> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|_| format!("{label} header could not be parsed as UTF-8 text."))?
        .iter()
        .map(normalize_cell)
        .collect::<Result<Vec<_>, _>>()?;
    let mut rows = Vec::new();
    for (index, result) in reader.records().enumerate() {
        if rows.len() >= MAX_IMPORT_ROWS + 1 {
            return Err("Import file must not exceed 5,000 data rows.".to_owned());
        }
        let record = result.map_err(|_| format!("{label} row {} is malformed.", index + 2))?;
        if record.len() > MAX_IMPORT_COLUMNS {
            return Err("Import file must not exceed 64 columns.".to_owned());
        }
        let mut cells = record
            .iter()
            .map(normalize_cell)
            .collect::<Result<Vec<_>, _>>()?;
        cells.resize(headers.len(), String::new());
        if cells.iter().any(|value| !value.is_empty()) {
            rows.push(ParsedTableRow {
                number: index + 2,
                cells,
            });
        }
    }
    validate_table(ParsedTable {
        format: format.to_owned(),
        sheet_name: None,
        headers,
        rows,
    })
}

fn parse_csv(bytes: &[u8]) -> Result<ParsedTable, String> {
    parse_delimited(bytes, b',', "csv", "CSV")
}

fn parse_tsv(bytes: &[u8]) -> Result<ParsedTable, String> {
    parse_delimited(bytes, b'\t', "tsv", "TSV")
}

fn parse_xlsx(bytes: &[u8]) -> Result<ParsedTable, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut workbook =
        Xlsx::new(cursor).map_err(|_| "XLSX workbook could not be opened.".to_owned())?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "XLSX workbook does not contain a worksheet.".to_owned())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|_| "The first XLSX worksheet could not be read.".to_owned())?;
    let mut table_rows = range.rows();
    let header_cells = table_rows
        .next()
        .ok_or_else(|| "XLSX workbook is empty.".to_owned())?;
    if header_cells.len() > MAX_IMPORT_COLUMNS {
        return Err("Import file must not exceed 64 columns.".to_owned());
    }
    let headers = header_cells
        .iter()
        .map(xlsx_cell_text)
        .collect::<Result<Vec<_>, _>>()?;
    let mut rows = Vec::new();
    for (index, row) in table_rows.enumerate() {
        if rows.len() >= MAX_IMPORT_ROWS + 1 {
            return Err("Import file must not exceed 5,000 data rows.".to_owned());
        }
        if row.len() > MAX_IMPORT_COLUMNS {
            return Err("Import file must not exceed 64 columns.".to_owned());
        }
        let mut cells = row
            .iter()
            .map(xlsx_cell_text)
            .collect::<Result<Vec<_>, _>>()?;
        cells.resize(headers.len(), String::new());
        if cells.iter().any(|value| !value.is_empty()) {
            rows.push(ParsedTableRow {
                number: index + 2,
                cells,
            });
        }
    }
    validate_table(ParsedTable {
        format: "xlsx".to_owned(),
        sheet_name: Some(sheet_name),
        headers,
        rows,
    })
}

fn xlsx_cell_text(cell: &Data) -> Result<String, String> {
    match cell {
        Data::DateTime(value) => normalize_cell(
            value
                .as_datetime()
                .map(|datetime| datetime.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| cell.to_string()),
        ),
        Data::DateTimeIso(value) => normalize_cell(
            value
                .get(..10)
                .filter(|candidate| candidate.len() == 10)
                .unwrap_or(value)
                .to_owned(),
        ),
        _ => normalize_cell(cell.to_string()),
    }
}

fn parse_table(file_name: &str, bytes: &[u8]) -> Result<ParsedTable, String> {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "csv" => parse_csv(bytes),
        "tsv" => parse_tsv(bytes),
        "xlsx" => parse_xlsx(bytes),
        _ => Err("Only .csv, .tsv and .xlsx files are supported.".to_owned()),
    }
}

fn parser_version(format: &str) -> &'static str {
    if format == "tsv" {
        TABLE_PARSER_VERSION
    } else {
        PARSER_VERSION
    }
}

fn matching_header(headers: &[String], aliases: &[&str]) -> Option<String> {
    headers.iter().find_map(|header| {
        let normalized = header.trim().to_lowercase();
        aliases
            .iter()
            .any(|alias| normalized == alias.to_lowercase())
            .then(|| header.clone())
    })
}

fn suggest_mapping(headers: &[String]) -> SuggestedImportMapping {
    SuggestedImportMapping {
        date: matching_header(
            headers,
            &[
                "日期",
                "交易日期",
                "发生日期",
                "date",
                "transaction date",
                "时间",
            ],
        ),
        amount: matching_header(
            headers,
            &["金额", "交易金额", "amount", "金额(元)", "amount cny"],
        ),
        transaction_type: matching_header(
            headers,
            &["类型", "收支类型", "交易类型", "type", "direction", "收支"],
        ),
        description: matching_header(
            headers,
            &[
                "备注",
                "摘要",
                "说明",
                "交易说明",
                "description",
                "memo",
                "用途",
            ],
        ),
        category: matching_header(headers, &["分类", "类别", "category"]),
        currency: matching_header(headers, &["币种", "currency"]),
        external_id: matching_header(
            headers,
            &[
                "流水号",
                "交易号",
                "外部id",
                "external id",
                "transaction id",
            ],
        ),
    }
}

fn inspect_file(request: InspectImportFileRequest) -> Result<InspectImportFileResponse, String> {
    let (file_name, bytes) = decode_file(request.file_name, request.content_base64)?;
    let fingerprint = source_fingerprint(&bytes);
    let table = parse_table(&file_name, &bytes)?;
    Ok(InspectImportFileResponse {
        file_name,
        format: table.format,
        sheet_name: table.sheet_name,
        source_fingerprint: fingerprint,
        suggested_mapping: suggest_mapping(&table.headers),
        headers: table.headers,
        sample_rows: table
            .rows
            .iter()
            .take(5)
            .map(|row| row.cells.clone())
            .collect(),
        row_count: table.rows.len(),
    })
}

fn column_index(headers: &[String], name: String, field: &str) -> Result<usize, String> {
    let name = required_text(name, field, 160)?;
    headers
        .iter()
        .position(|header| header == &name)
        .ok_or_else(|| format!("The selected {field} column does not exist."))
}

fn optional_column_index(
    headers: &[String],
    name: Option<String>,
    field: &str,
) -> Result<Option<usize>, String> {
    name.filter(|value| !value.trim().is_empty())
        .map(|value| column_index(headers, value, field))
        .transpose()
}

fn resolve_mapping(
    headers: &[String],
    mapping: &ImportColumnMapping,
) -> Result<ResolvedMapping, String> {
    Ok(ResolvedMapping {
        date: column_index(headers, mapping.date.clone(), "date")?,
        amount: column_index(headers, mapping.amount.clone(), "amount")?,
        transaction_type: optional_column_index(
            headers,
            mapping.transaction_type.clone(),
            "transaction type",
        )?,
        description: optional_column_index(headers, mapping.description.clone(), "description")?,
        category: optional_column_index(headers, mapping.category.clone(), "category")?,
        currency: optional_column_index(headers, mapping.currency.clone(), "currency")?,
        external_id: optional_column_index(
            headers,
            mapping.external_id.clone(),
            "external identifier",
        )?,
    })
}

fn normalize_date(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() >= 10 {
        let candidate = &value[..10];
        for separator in ['-', '/'] {
            let parts = candidate.split(separator).collect::<Vec<_>>();
            if parts.len() == 3
                && parts[0].len() == 4
                && parts[1].len() == 2
                && parts[2].len() == 2
                && parts
                    .iter()
                    .all(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
            {
                let year = parts[0].parse::<i32>().unwrap_or_default();
                let month = parts[1].parse::<u32>().unwrap_or_default();
                let day = parts[2].parse::<u32>().unwrap_or_default();
                if chrono::NaiveDate::from_ymd_opt(year, month, day).is_some() {
                    return Ok(format!("{year:04}-{month:02}-{day:02}"));
                }
            }
        }
    }
    Err("Date must be a valid YYYY-MM-DD value.".to_owned())
}

fn normalized_amount_text(value: &str) -> Result<(bool, String), String> {
    let mut value = value
        .trim()
        .replace([',', ' ', '¥', '￥'], "")
        .replace("CNY", "")
        .replace("cny", "");
    let negative_parentheses = value.starts_with('(') && value.ends_with(')');
    if negative_parentheses {
        value = value[1..value.len() - 1].to_owned();
    }
    let negative = negative_parentheses || value.starts_with('-');
    let unsigned = value
        .strip_prefix(['-', '+'])
        .unwrap_or(value.as_str())
        .to_owned();
    if unsigned.is_empty() {
        return Err("Amount is required.".to_owned());
    }
    Ok((negative, unsigned))
}

fn parse_positive_minor(value: &str) -> Result<(bool, i64), String> {
    let (negative, unsigned) = normalized_amount_text(value)?;
    let mut parts = unsigned.split('.');
    let major = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || major.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || fraction
            .is_some_and(|part| part.len() > 2 || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Amount must contain at most two decimal places.".to_owned());
    }
    let major: i128 = major
        .parse()
        .map_err(|_| "Amount is outside the supported range.".to_owned())?;
    let fraction = match fraction.unwrap_or_default() {
        "" => 0_i128,
        value if value.len() == 1 => value
            .parse::<i128>()
            .map(|number| number * 10)
            .map_err(|_| "Amount is invalid.".to_owned())?,
        value => value
            .parse::<i128>()
            .map_err(|_| "Amount is invalid.".to_owned())?,
    };
    let minor = major
        .checked_mul(100)
        .and_then(|value| value.checked_add(fraction))
        .ok_or_else(|| "Amount is outside the supported range.".to_owned())?;
    if minor <= 0 || minor > MAX_SAFE_MINOR {
        return Err("Amount must be greater than zero and within the supported range.".to_owned());
    }
    Ok((negative, minor as i64))
}

fn normalize_transaction_kind(
    value: Option<&str>,
    amount_negative: bool,
) -> Result<String, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(if amount_negative { "expense" } else { "income" }.to_owned());
    };
    let normalized = value.to_lowercase();
    if ["income", "收入", "入账", "credit", "存入", "收"].contains(&normalized.as_str()) {
        return Ok("income".to_owned());
    }
    if ["expense", "支出", "出账", "debit", "取出", "付"].contains(&normalized.as_str()) {
        return Ok("expense".to_owned());
    }
    Err("Transaction type must be income/收入 or expense/支出.".to_owned())
}

fn optional_cell(row: &ParsedTableRow, index: Option<usize>) -> Option<String> {
    index
        .and_then(|position| row.cells.get(position))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn active_account(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<(String, String), String> {
    connection
        .query_row(
            "SELECT display_name, currency
             FROM accounts
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![account_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to validate the import account.".to_owned())?
        .ok_or_else(|| "The selected import account is unavailable.".to_owned())
}

fn build_import_payload(
    connection: &Connection,
    vault_id: &str,
    request: CreateImportDraftRequest,
) -> Result<ImportDraftPayload, String> {
    let (file_name, bytes) = decode_file(request.file_name, request.content_base64)?;
    let fingerprint = source_fingerprint(&bytes);
    let table = parse_table(&file_name, &bytes)?;
    let resolved = resolve_mapping(&table.headers, &request.mapping)?;
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    let (account_name, account_currency) = active_account(connection, vault_id, &account_id)?;

    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let mut external_ids = HashSet::new();
    let mut income_total = 0_i128;
    let mut expense_total = 0_i128;
    for table_row in &table.rows {
        let parsed = (|| {
            let occurred_on = normalize_date(
                table_row
                    .cells
                    .get(resolved.date)
                    .map(String::as_str)
                    .unwrap_or_default(),
            )?;
            let (negative, amount_minor) = parse_positive_minor(
                table_row
                    .cells
                    .get(resolved.amount)
                    .map(String::as_str)
                    .unwrap_or_default(),
            )?;
            let transaction_kind = normalize_transaction_kind(
                resolved
                    .transaction_type
                    .and_then(|index| table_row.cells.get(index))
                    .map(String::as_str),
                negative,
            )?;
            if let Some(currency) = optional_cell(table_row, resolved.currency) {
                if currency.to_ascii_uppercase() != account_currency {
                    return Err(format!(
                        "Row currency {currency} does not match account currency {account_currency}."
                    ));
                }
            }
            let description = optional_cell(table_row, resolved.description)
                .unwrap_or_else(|| format!("导入流水 · 第 {} 行", table_row.number));
            if description.chars().count() > 160 {
                return Err("Description must not exceed 160 characters.".to_owned());
            }
            let category = optional_cell(table_row, resolved.category);
            if category
                .as_ref()
                .is_some_and(|value| value.chars().count() > 60)
            {
                return Err("Category must not exceed 60 characters.".to_owned());
            }
            let external_id = optional_cell(table_row, resolved.external_id);
            if external_id
                .as_ref()
                .is_some_and(|value| value.chars().count() > 160)
            {
                return Err("External identifier must not exceed 160 characters.".to_owned());
            }
            Ok(ImportPreviewRow {
                row: table_row.number,
                event_id: random_id("event")?,
                transaction_kind,
                amount_minor,
                currency: account_currency.clone(),
                occurred_on,
                description,
                category,
                external_id,
            })
        })();
        match parsed {
            Ok(row) => {
                if row
                    .external_id
                    .as_ref()
                    .is_some_and(|external_id| !external_ids.insert(external_id.clone()))
                {
                    errors.push(ImportRowError {
                        row: table_row.number,
                        message: "External identifier is duplicated within this import file."
                            .to_owned(),
                    });
                    continue;
                }
                if row.transaction_kind == "income" {
                    income_total += i128::from(row.amount_minor);
                } else {
                    expense_total += i128::from(row.amount_minor);
                }
                rows.push(row);
            }
            Err(message) => errors.push(ImportRowError {
                row: table_row.number,
                message,
            }),
        }
    }
    if rows.is_empty() {
        return Err("No valid income or expense rows are available for review.".to_owned());
    }
    let net = income_total - expense_total;
    if income_total > MAX_SAFE_MINOR || expense_total > MAX_SAFE_MINOR || net.abs() > MAX_SAFE_MINOR
    {
        return Err("Import totals exceed the supported safety range.".to_owned());
    }
    let report = ImportReconciliationReport {
        accepted_count: rows.len(),
        error_count: errors.len(),
        total_income_minor: income_total as i64,
        total_expense_minor: expense_total as i64,
        net_change_minor: net as i64,
        currency: account_currency.clone(),
    };
    let parser_version = parser_version(&table.format).to_owned();
    Ok(ImportDraftPayload {
        kind: "transaction.import".to_owned(),
        import_batch_id: String::new(),
        source_name: file_name,
        source_format: table.format,
        source_fingerprint: fingerprint,
        parser_version,
        sheet_name: table.sheet_name,
        account_id,
        account_name,
        currency: account_currency,
        mapping: request.mapping,
        rows,
        errors,
        report,
    })
}

fn import_response(
    draft_id: Option<String>,
    payload: ImportDraftPayload,
    already_imported: bool,
    status: &str,
) -> ImportDraftResponse {
    ImportDraftResponse {
        draft_id,
        import_batch_id: payload.import_batch_id,
        source_name: payload.source_name,
        source_format: payload.source_format,
        source_fingerprint: payload.source_fingerprint,
        sheet_name: payload.sheet_name,
        account_id: payload.account_id,
        account_name: payload.account_name,
        currency: payload.currency,
        rows: payload.rows,
        errors: payload.errors,
        report: payload.report,
        already_imported,
        status: status.to_owned(),
    }
}

fn create_import_draft_at(
    runtime: &VaultRuntime,
    request: CreateImportDraftRequest,
) -> Result<ImportDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let mut payload = build_import_payload(connection, vault_id, request)?;
        let existing: Option<(String, String)> = connection
            .query_row(
                "SELECT id, status FROM import_batches
                 WHERE vault_id = ?1 AND source_fingerprint = ?2 AND parser_version = ?3",
                params![vault_id, payload.source_fingerprint, payload.parser_version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to inspect previous imports.".to_owned())?;
        if let Some((batch_id, status)) = existing.as_ref() {
            if status == "confirmed" {
                let stored: Option<String> = connection
                    .query_row(
                        "SELECT proposed_events_json FROM draft_changes
                         WHERE vault_id = ?1 AND import_batch_id = ?2
                           AND source_type = 'transaction_import' AND status = 'confirmed'
                         ORDER BY confirmed_at DESC LIMIT 1",
                        params![vault_id, batch_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|_| "Unable to read the confirmed import report.".to_owned())?;
                if let Some(stored) = stored {
                    let stored_payload: ImportDraftPayload = serde_json::from_str(&stored)
                        .map_err(|_| "The confirmed import report is invalid.".to_owned())?;
                    return Ok(import_response(None, stored_payload, true, "confirmed"));
                }
                payload.import_batch_id = batch_id.clone();
                return Ok(import_response(None, payload, true, "confirmed"));
            }
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the import review transaction.".to_owned())?;
        let batch_id = existing
            .as_ref()
            .map(|(id, _)| id.clone())
            .unwrap_or(random_id("import")?);
        payload.import_batch_id = batch_id.clone();
        if existing.is_some() {
            transaction
                .execute(
                    "UPDATE draft_changes
                     SET status = 'rejected',
                         rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                         rejection_reason = 'superseded_mapping'
                     WHERE vault_id = ?1 AND import_batch_id = ?2
                       AND source_type = 'transaction_import' AND status = 'needs_review'",
                    params![vault_id, batch_id],
                )
                .map_err(|_| "Unable to replace the previous import review.".to_owned())?;
            transaction
                .execute(
                    "UPDATE import_batches
                     SET source_name = ?3, source_type = ?4, status = 'needs_review',
                         row_count = ?5, error_count = ?6, confirmed_at = NULL
                     WHERE id = ?1 AND vault_id = ?2",
                    params![
                        batch_id,
                        vault_id,
                        payload.source_name,
                        payload.source_format,
                        (payload.report.accepted_count + payload.report.error_count) as i64,
                        payload.report.error_count as i64
                    ],
                )
                .map_err(|_| "Unable to refresh the import batch.".to_owned())?;
        } else {
            transaction
                .execute(
                    "INSERT INTO import_batches(
                        id, vault_id, source_type, source_name, source_fingerprint,
                        parser_version, status, row_count, error_count, created_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, 'needs_review', ?7, ?8,
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     )",
                    params![
                        batch_id,
                        vault_id,
                        payload.source_format,
                        payload.source_name,
                        payload.source_fingerprint,
                        payload.parser_version,
                        (payload.report.accepted_count + payload.report.error_count) as i64,
                        payload.report.error_count as i64
                    ],
                )
                .map_err(|_| "Unable to create the import batch.".to_owned())?;
        }
        let draft_id = random_id("draft")?;
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the import review.".to_owned())?;
        let evidence = json!({
            "sourceFingerprint": payload.source_fingerprint,
            "parserVersion": payload.parser_version,
            "rowErrors": payload.errors,
            "reviewRequired": true
        })
        .to_string();
        transaction
            .execute(
                "INSERT INTO draft_changes(
                    id, vault_id, import_batch_id, source_type, source_fingerprint,
                    status, proposed_events_json, evidence_json, created_at
                 ) VALUES (
                    ?1, ?2, ?3, 'transaction_import', ?4, 'needs_review',
                    ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    draft_id,
                    vault_id,
                    batch_id,
                    payload.source_fingerprint,
                    proposed,
                    evidence
                ],
            )
            .map_err(|_| "Unable to save the import review draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'import_review_created', 'local_user',
                    'import_batch', ?3, ?4,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    batch_id,
                    json!({
                        "sourceType": payload.source_format,
                        "acceptedCount": payload.report.accepted_count,
                        "errorCount": payload.report.error_count
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the import review audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the import review.".to_owned())?;
        Ok(import_response(
            Some(draft_id),
            payload,
            false,
            "needs_review",
        ))
    })
}

fn confirm_import_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmImportDraftRequest,
) -> Result<ImportConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String, String)> = connection
            .query_row(
                "SELECT status, import_batch_id, proposed_events_json
                 FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'transaction_import'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the import review draft.".to_owned())?;
        let Some((status, batch_id, proposed)) = row else {
            return Err("The import review draft does not exist.".to_owned());
        };
        let payload: ImportDraftPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The import review draft is invalid.".to_owned())?;
        if payload.kind != "transaction.import" || payload.import_batch_id != batch_id {
            return Err("The import review draft type is invalid.".to_owned());
        }
        if status == "confirmed" {
            return Ok(ImportConfirmationResponse {
                draft_id,
                import_batch_id: batch_id,
                report: payload.report,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err("The import review is no longer available for confirmation.".to_owned());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the import confirmation.".to_owned())?;
        let (_, current_currency) = active_account(&transaction, vault_id, &payload.account_id)?;
        if current_currency != payload.currency {
            return Err("The import account currency changed after review.".to_owned());
        }
        let current_balance: i64 = transaction
            .query_row(
                "SELECT COALESCE(SUM(delta_minor), 0)
                 FROM ledger_events WHERE vault_id = ?1 AND account_id = ?2",
                params![vault_id, payload.account_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to verify the import account balance.".to_owned())?;
        let projected = i128::from(current_balance) + i128::from(payload.report.net_change_minor);
        if projected.abs() > MAX_SAFE_MINOR {
            return Err("The imported balance would exceed the supported safety range.".to_owned());
        }
        for row in &payload.rows {
            let delta_minor = if row.transaction_kind == "income" {
                row.amount_minor
            } else {
                -row.amount_minor
            };
            let occurred_at = format!("{}T00:00:00.000Z", row.occurred_on);
            let idempotency_component = row.external_id.as_deref().unwrap_or_else(|| {
                // The row number is stable for the exact source fingerprint.
                ""
            });
            let idempotency_key = if idempotency_component.is_empty() {
                format!("import:{}:row:{}", payload.source_fingerprint, row.row)
            } else {
                format!(
                    "import:{}:external:{}",
                    payload.source_fingerprint, idempotency_component
                )
            };
            let metadata = json!({
                "source": if payload.source_format == "tsv" {
                    "pasted_table"
                } else {
                    "file_import"
                },
                "sourceName": payload.source_name,
                "sourceFormat": payload.source_format,
                "sourceFingerprint": payload.source_fingerprint,
                "sourceRow": row.row,
                "parserVersion": payload.parser_version,
                "description": row.description,
                "category": row.category,
                "externalId": row.external_id,
                "transactionKind": row.transaction_kind
            })
            .to_string();
            transaction
                .execute(
                    "INSERT INTO ledger_events(
                        id, vault_id, account_id, draft_id, import_batch_id,
                        event_type, delta_minor, currency, occurred_at, status,
                        idempotency_key, metadata_json, created_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'confirmed',
                        ?10, ?11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     )",
                    params![
                        row.event_id,
                        vault_id,
                        payload.account_id,
                        draft_id,
                        batch_id,
                        row.transaction_kind,
                        delta_minor,
                        row.currency,
                        occurred_at,
                        idempotency_key,
                        metadata
                    ],
                )
                .map_err(|_| "Unable to append an imported ledger event.".to_owned())?;
        }
        let draft_updated = transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the import review.".to_owned())?;
        let batch_updated = transaction
            .execute(
                "UPDATE import_batches
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![batch_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the import batch.".to_owned())?;
        if draft_updated != 1 || batch_updated != 1 {
            return Err("The import review changed before confirmation.".to_owned());
        }
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'transaction_import_confirmed', 'local_user',
                    'import_batch', ?3, ?4,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    batch_id,
                    json!({
                        "sourceFingerprint": payload.source_fingerprint,
                        "acceptedCount": payload.report.accepted_count,
                        "errorCount": payload.report.error_count,
                        "currency": payload.report.currency,
                        "netChangeMinor": payload.report.net_change_minor
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the import audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the import confirmation.".to_owned())?;
        Ok(ImportConfirmationResponse {
            draft_id,
            import_batch_id: batch_id,
            report: payload.report,
            status: "confirmed",
        })
    })
}

fn reject_import_draft_at(
    runtime: &VaultRuntime,
    request: RejectImportDraftRequest,
) -> Result<ImportRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, import_batch_id FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'transaction_import'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the import review draft.".to_owned())?;
        let Some((status, batch_id)) = row else {
            return Err("The import review draft does not exist.".to_owned());
        };
        if status == "confirmed" {
            return Err("A confirmed import cannot be rejected.".to_owned());
        }
        if status == "rejected" {
            return Ok(ImportRejectionResponse {
                draft_id,
                import_batch_id: batch_id,
                status: "rejected",
            });
        }
        if status != "needs_review" {
            return Err("The import review state is invalid.".to_owned());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the import rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the import review.".to_owned())?;
        transaction
            .execute(
                "UPDATE import_batches SET status = 'rejected'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![batch_id, vault_id],
            )
            .map_err(|_| "Unable to reject the import batch.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'transaction_import_rejected', 'local_user',
                    'import_batch', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, batch_id],
            )
            .map_err(|_| "Unable to append the import rejection audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the import rejection.".to_owned())?;
        Ok(ImportRejectionResponse {
            draft_id,
            import_batch_id: batch_id,
            status: "rejected",
        })
    })
}

pub(crate) fn import_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Vec<ImportBatchSnapshot>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, source_type, source_name, source_fingerprint,
                    parser_version, status, row_count, error_count,
                    created_at, confirmed_at
             FROM import_batches
             WHERE vault_id = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT 20",
        )
        .map_err(|_| "Unable to prepare import history.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            Ok(ImportBatchSnapshot {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_name: row.get(2)?,
                source_fingerprint: row.get(3)?,
                parser_version: row.get(4)?,
                status: row.get(5)?,
                row_count: row.get(6)?,
                error_count: row.get(7)?,
                created_at: row.get(8)?,
                confirmed_at: row.get(9)?,
            })
        })
        .map_err(|_| "Unable to read import history.".to_owned())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode import history.".to_owned())
}

#[tauri::command]
pub async fn transaction_import_inspect(
    runtime: tauri::State<'_, VaultRuntime>,
    request: InspectImportFileRequest,
) -> Result<InspectImportFileResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|_, _| inspect_file(request))
    })
    .await
    .map_err(|_| "Import inspection task failed.".to_owned())?
}

#[tauri::command]
pub async fn transaction_import_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateImportDraftRequest,
) -> Result<ImportDraftResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || create_import_draft_at(&runtime, request))
        .await
        .map_err(|_| "Import review task failed.".to_owned())?
}

#[tauri::command]
pub async fn transaction_import_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmImportDraftRequest,
) -> Result<ImportConfirmationResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || confirm_import_draft_at(&runtime, request))
        .await
        .map_err(|_| "Import confirmation task failed.".to_owned())?
}

#[tauri::command]
pub async fn transaction_import_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectImportDraftRequest,
) -> Result<ImportRejectionResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reject_import_draft_at(&runtime, request))
        .await
        .map_err(|_| "Import rejection task failed.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn setup_runtime() -> VaultRuntime {
        let runtime = VaultRuntime::default();
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', 'Import test', 'CNY', '2026-07-26T00:00:00.000Z')",
                [],
            )
            .expect("vault fixture should insert");
        connection
            .execute(
                "INSERT INTO accounts(
                    id, vault_id, institution_name, display_name, account_type,
                    currency, created_at
                 ) VALUES (
                    'account-1', 'vault-1', '演示银行', '导入账户', 'cash',
                    'CNY', '2026-07-26T00:00:00.000Z'
                 )",
                [],
            )
            .expect("account fixture should insert");
        runtime.install_test_session("vault-1", connection);
        runtime
    }

    fn csv_base64(text: &str) -> String {
        STANDARD.encode(text.as_bytes())
    }

    fn xlsx_bytes() -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        let files = [
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="虚构流水" sheetId="1" r:id="rId1"/></sheets>
                </workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <sheetData>
                    <row r="1">
                      <c r="A1" t="inlineStr"><is><t>日期</t></is></c>
                      <c r="B1" t="inlineStr"><is><t>金额</t></is></c>
                      <c r="C1" t="inlineStr"><is><t>类型</t></is></c>
                      <c r="D1" t="inlineStr"><is><t>说明</t></is></c>
                    </row>
                    <row r="2">
                      <c r="A2" t="inlineStr"><is><t>2026-07-24</t></is></c>
                      <c r="B2"><v>368.50</v></c>
                      <c r="C2" t="inlineStr"><is><t>支出</t></is></c>
                      <c r="D2" t="inlineStr"><is><t>虚构 XLSX 流水</t></is></c>
                    </row>
                  </sheetData>
                </worksheet>"#,
            ),
        ];
        for (name, content) in files {
            archive
                .start_file(name, options)
                .expect("XLSX part should start");
            archive
                .write_all(content.as_bytes())
                .expect("XLSX part should write");
        }
        archive
            .finish()
            .expect("XLSX archive should finish")
            .into_inner()
    }

    fn mapping() -> ImportColumnMapping {
        ImportColumnMapping {
            date: "日期".to_owned(),
            amount: "金额".to_owned(),
            transaction_type: Some("类型".to_owned()),
            description: Some("说明".to_owned()),
            category: Some("分类".to_owned()),
            currency: Some("币种".to_owned()),
            external_id: Some("流水号".to_owned()),
        }
    }

    fn create_request(text: &str) -> CreateImportDraftRequest {
        CreateImportDraftRequest {
            file_name: "虚构流水.csv".to_owned(),
            content_base64: csv_base64(text),
            account_id: "account-1".to_owned(),
            mapping: mapping(),
        }
    }

    #[test]
    fn csv_inspection_suggests_mapping_without_persisting_plaintext() {
        let text = "日期,金额,类型,说明,分类,币种,流水号\n\
                    2026-07-24,12800.50,收入,虚构租金,租金,CNY,demo-001";
        let result = inspect_file(InspectImportFileRequest {
            file_name: "虚构流水.csv".to_owned(),
            content_base64: csv_base64(text),
        })
        .expect("CSV should inspect");
        assert_eq!(result.row_count, 1);
        assert_eq!(result.format, "csv");
        assert_eq!(result.suggested_mapping.date.as_deref(), Some("日期"));
        assert_eq!(result.suggested_mapping.amount.as_deref(), Some("金额"));
        assert_eq!(result.source_fingerprint.len(), 64);
    }

    #[test]
    fn pasted_tsv_is_reviewed_before_append_and_records_its_local_source() {
        let runtime = setup_runtime();
        let text = "日期\t金额\t类型\t说明\t分类\t币种\t流水号\n\
                    2026-07-24\t-368.50\t支出\t飞书虚构流水\t购物\tCNY\tfeishu-demo-001";
        let inspection = inspect_file(InspectImportFileRequest {
            file_name: "粘贴表格.tsv".to_owned(),
            content_base64: csv_base64(text),
        })
        .expect("pasted TSV should inspect");
        assert_eq!(inspection.format, "tsv");
        assert_eq!(inspection.row_count, 1);
        assert_eq!(inspection.headers[3], "说明");
        assert_eq!(inspection.suggested_mapping.amount.as_deref(), Some("金额"));

        let draft = create_import_draft_at(
            &runtime,
            CreateImportDraftRequest {
                file_name: "粘贴表格.tsv".to_owned(),
                content_base64: csv_base64(text),
                account_id: "account-1".to_owned(),
                mapping: mapping(),
            },
        )
        .expect("pasted TSV should create a review draft");
        assert_eq!(draft.source_format, "tsv");
        assert_eq!(draft.report.accepted_count, 1);
        assert_eq!(draft.report.total_expense_minor, 36_850);
        let draft_id = draft.draft_id.expect("review draft should exist");

        confirm_import_draft_at(
            &runtime,
            ConfirmImportDraftRequest {
                draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("explicit confirmation should append the pasted row");

        runtime
            .with_unlocked_connection(|_, connection| {
                let (source_type, parser_version, status): (String, String, String) = connection
                    .query_row(
                        "SELECT source_type, parser_version, status FROM import_batches",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                assert_eq!(source_type, "tsv");
                assert_eq!(parser_version, TABLE_PARSER_VERSION);
                assert_eq!(status, "confirmed");

                let (delta_minor, metadata_json): (i64, String) = connection
                    .query_row(
                        "SELECT delta_minor, metadata_json FROM ledger_events",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                let metadata: serde_json::Value =
                    serde_json::from_str(&metadata_json).expect("metadata should be JSON");
                assert_eq!(delta_minor, -36_850);
                assert_eq!(metadata["source"], "pasted_table");
                assert_eq!(metadata["sourceFormat"], "tsv");
                assert_eq!(metadata["description"], "飞书虚构流水");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn xlsx_inspection_reads_the_first_sheet_from_memory() {
        let bytes = xlsx_bytes();
        let result = inspect_file(InspectImportFileRequest {
            file_name: "虚构流水.xlsx".to_owned(),
            content_base64: STANDARD.encode(bytes),
        })
        .expect("XLSX should inspect");
        assert_eq!(result.format, "xlsx");
        assert_eq!(result.sheet_name.as_deref(), Some("虚构流水"));
        assert_eq!(result.row_count, 1);
        assert_eq!(result.headers, ["日期", "金额", "类型", "说明"]);
        assert_eq!(result.sample_rows[0][1], "368.5");
    }

    #[test]
    fn import_confirmation_is_atomic_idempotent_and_reports_row_errors() {
        let runtime = setup_runtime();
        let text = "日期,金额,类型,说明,分类,币种,流水号\n\
                    2026-07-24,12800.50,收入,虚构租金,租金,CNY,demo-001\n\
                    bad-date,99.00,支出,错误行,其他,CNY,demo-002\n\
                    2026-07-25,-368.50,支出,虚构用品,购物,CNY,demo-003";
        let draft = create_import_draft_at(&runtime, create_request(text))
            .expect("review draft should create");
        assert_eq!(draft.report.accepted_count, 2);
        assert_eq!(draft.report.error_count, 1);
        assert_eq!(draft.report.total_income_minor, 1_280_050);
        assert_eq!(draft.report.total_expense_minor, 36_850);
        assert_eq!(draft.report.net_change_minor, 1_243_200);
        let draft_id = draft.draft_id.expect("draft id should exist");

        let first = confirm_import_draft_at(
            &runtime,
            ConfirmImportDraftRequest {
                draft_id: draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("import should confirm");
        let second = confirm_import_draft_at(
            &runtime,
            ConfirmImportDraftRequest {
                draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("confirmation retry should be idempotent");
        assert_eq!(first.import_batch_id, second.import_batch_id);
        runtime
            .with_unlocked_connection(|_, connection| {
                let event_count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .unwrap();
                let balance: i64 = connection
                    .query_row("SELECT sum(delta_minor) FROM ledger_events", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                let batch_status: String = connection
                    .query_row("SELECT status FROM import_batches", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(event_count, 2);
                assert_eq!(balance, 1_243_200);
                assert_eq!(batch_status, "confirmed");
                Ok(())
            })
            .unwrap();

        let duplicate = create_import_draft_at(&runtime, create_request(text))
            .expect("duplicate file should return the confirmed report");
        assert!(duplicate.already_imported);
        assert!(duplicate.draft_id.is_none());
        assert_eq!(duplicate.status, "confirmed");
    }

    #[test]
    fn duplicate_external_ids_are_skipped_during_review() {
        let runtime = setup_runtime();
        let text = "日期,金额,类型,说明,分类,币种,流水号\n\
                    2026-07-24,100.00,收入,虚构收入一,其他,CNY,duplicate-001\n\
                    2026-07-25,200.00,收入,虚构收入二,其他,CNY,duplicate-001";
        let draft = create_import_draft_at(&runtime, create_request(text))
            .expect("valid rows should remain reviewable");
        assert_eq!(draft.report.accepted_count, 1);
        assert_eq!(draft.report.error_count, 1);
        assert_eq!(
            draft.errors[0].message,
            "External identifier is duplicated within this import file."
        );
    }

    #[test]
    fn rejected_import_is_inert_and_can_be_remapped() {
        let runtime = setup_runtime();
        let text = "日期,金额,类型,说明,分类,币种,流水号\n\
                    2026-07-24,100.00,收入,虚构收入,其他,CNY,demo-001";
        let first = create_import_draft_at(&runtime, create_request(text))
            .expect("review draft should create");
        reject_import_draft_at(
            &runtime,
            RejectImportDraftRequest {
                draft_id: first.draft_id.expect("draft id should exist"),
            },
        )
        .expect("draft should reject");
        let second = create_import_draft_at(&runtime, create_request(text))
            .expect("rejected file should be reviewable again");
        assert!(!second.already_imported);
        assert!(second.draft_id.is_some());
        runtime
            .with_unlocked_connection(|_, connection| {
                let event_count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(event_count, 0);
                Ok(())
            })
            .unwrap();
    }
}
