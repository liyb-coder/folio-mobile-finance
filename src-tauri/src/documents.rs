use crate::vault::VaultRuntime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::CStr,
    fs,
    os::raw::{c_char, c_int},
    path::Path,
};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS: usize = 40_000;
const MAX_EVIDENCE_BLOCKS: usize = 80;
const MAX_FILE_NAME_CHARS: usize = 255;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeBlock {
    page: usize,
    text: String,
    confidence: Option<f64>,
    #[serde(rename = "box")]
    bounding_box: Option<NativeBox>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeExtraction {
    format: String,
    page_count: usize,
    blocks: Vec<NativeBlock>,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    ocr_page_count: usize,
    #[serde(default)]
    unreadable_page_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEvidenceBlock {
    page: usize,
    text: String,
    range_start: usize,
    range_end: usize,
    confidence_bps: Option<i64>,
    bounding_box: Option<DocumentBoundingBox>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBoundingBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExtractionResponse {
    status: &'static str,
    file_name: Option<String>,
    format: Option<String>,
    file_hash: Option<String>,
    byte_count: Option<u64>,
    page_count: Option<usize>,
    ocr_page_count: Option<usize>,
    unreadable_page_count: Option<usize>,
    text: Option<String>,
    evidence: Vec<DocumentEvidenceBlock>,
    truncated: bool,
    privacy: &'static str,
}

fn normalized_file_name(path: &Path) -> Result<String, String> {
    let value = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Selected document name is invalid.".to_owned())?;
    if value.is_empty() || value.chars().count() > MAX_FILE_NAME_CHARS {
        return Err("Selected document name is invalid.".to_owned());
    }
    Ok(value.to_owned())
}

fn document_kind(file_name: &str, bytes: &[u8]) -> Result<c_int, String> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension == "pdf" && bytes.starts_with(b"%PDF-") {
        return Ok(1);
    }
    let is_png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let is_jpeg = bytes.starts_with(&[0xff, 0xd8, 0xff]);
    let is_tiff = bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*");
    let is_heic = bytes
        .get(4..12)
        .is_some_and(|value| value == b"ftypheic" || value == b"ftypheix" || value == b"ftypmif1");
    let extension_matches = matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "heic" | "heif" | "tif" | "tiff"
    );
    if extension_matches && (is_png || is_jpeg || is_tiff || is_heic) {
        return Ok(2);
    }
    if matches!(extension.as_str(), "md" | "markdown" | "txt")
        && !bytes.contains(&0)
        && std::str::from_utf8(bytes).is_ok()
    {
        return Ok(3);
    }
    Err(
        "Only valid PDF, PNG, JPEG, HEIC, TIFF, Markdown or plain-text files are supported."
            .to_owned(),
    )
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn extract_with_apple(bytes: &[u8], kind: c_int) -> Result<NativeExtraction, String> {
    extern "C" {
        fn folio_apple_extract_document(
            bytes: *const u8,
            length: usize,
            kind: c_int,
            error_out: *mut *mut c_char,
        ) -> *mut c_char;
        fn folio_apple_free_string(value: *mut c_char);
    }
    let mut error_pointer: *mut c_char = std::ptr::null_mut();
    let result_pointer = unsafe {
        folio_apple_extract_document(bytes.as_ptr(), bytes.len(), kind, &mut error_pointer)
    };
    if result_pointer.is_null() {
        let message = if error_pointer.is_null() {
            "Local document extraction failed.".to_owned()
        } else {
            let message = unsafe { CStr::from_ptr(error_pointer) }
                .to_string_lossy()
                .into_owned();
            unsafe { folio_apple_free_string(error_pointer) };
            message
        };
        return Err(message);
    }
    let json = unsafe { CStr::from_ptr(result_pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { folio_apple_free_string(result_pointer) };
    serde_json::from_str(&json).map_err(|_| "Local document evidence is invalid.".to_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn extract_with_apple(_bytes: &[u8], _kind: c_int) -> Result<NativeExtraction, String> {
    Err("Local PDF and image extraction is currently available on Apple devices.".to_owned())
}

fn push_limited_text(target: &mut String, value: &str, remaining: usize) -> (usize, bool) {
    let normalized = value.replace('\0', "").trim().to_owned();
    if normalized.is_empty() || remaining == 0 {
        return (0, !normalized.is_empty());
    }
    let take = normalized.chars().count().min(remaining);
    target.extend(normalized.chars().take(take));
    (take, take < normalized.chars().count())
}

fn normalize_extraction(
    native: NativeExtraction,
) -> Result<(String, Vec<DocumentEvidenceBlock>, bool), String> {
    if native.page_count == 0 || native.page_count > 50 {
        return Err("Extracted document page count is invalid.".to_owned());
    }
    if !matches!(
        native.format.as_str(),
        "pdf" | "image" | "markdown" | "text"
    ) {
        return Err("Extracted document format is invalid.".to_owned());
    }
    let mut text = String::new();
    let mut evidence = Vec::new();
    let mut truncated = native.truncated
        || native.unreadable_page_count > 0
        || native.blocks.len() > MAX_EVIDENCE_BLOCKS;
    for block in native.blocks.into_iter().take(MAX_EVIDENCE_BLOCKS) {
        if block.page == 0 || block.page > native.page_count {
            continue;
        }
        if !text.is_empty() {
            if text.chars().count() >= MAX_EXTRACTED_CHARS {
                truncated = true;
                break;
            }
            text.push('\n');
        }
        let range_start = text.chars().count();
        let remaining = MAX_EXTRACTED_CHARS.saturating_sub(range_start);
        let (written, block_truncated) = push_limited_text(&mut text, &block.text, remaining);
        if written == 0 {
            truncated |= block_truncated;
            continue;
        }
        let range_end = range_start + written;
        let confidence_bps = block.confidence.and_then(|confidence| {
            confidence
                .is_finite()
                .then(|| (confidence.clamp(0.0, 1.0) * 10_000.0).round() as i64)
        });
        let bounding_box = block.bounding_box.and_then(|value| {
            let values = [value.x, value.y, value.width, value.height];
            if values
                .iter()
                .all(|number| number.is_finite() && (0.0..=1.0).contains(number))
                && value.x + value.width <= 1.0
                && value.y + value.height <= 1.0
            {
                Some(DocumentBoundingBox {
                    x: value.x,
                    y: value.y,
                    width: value.width,
                    height: value.height,
                })
            } else {
                None
            }
        });
        evidence.push(DocumentEvidenceBlock {
            page: block.page,
            text: block.text.chars().take(written).collect(),
            range_start,
            range_end,
            confidence_bps,
            bounding_box,
        });
        truncated |= block_truncated;
        if text.chars().count() >= MAX_EXTRACTED_CHARS {
            truncated = true;
            break;
        }
    }
    if evidence.is_empty() || text.trim().is_empty() {
        return Err("No reviewable text evidence was extracted from the document.".to_owned());
    }
    Ok((text, evidence, truncated))
}

fn extract_path(path: &Path) -> Result<DocumentExtractionResponse, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "Selected document is unavailable.".to_owned())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("Document files must contain 1 byte to 10 MB.".to_owned());
    }
    let file_name = normalized_file_name(path)?;
    let bytes = Zeroizing::new(
        fs::read(path).map_err(|_| "Unable to read the selected document.".to_owned())?,
    );
    let kind = document_kind(&file_name, bytes.as_slice())?;
    let file_hash = hex::encode(Sha256::digest(bytes.as_slice()));
    let native = if kind == 3 {
        let extension = Path::new(&file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let text = std::str::from_utf8(bytes.as_slice())
            .map_err(|_| "The selected text document is not valid UTF-8.".to_owned())?
            .trim_start_matches('\u{feff}')
            .to_owned();
        NativeExtraction {
            format: if matches!(extension.as_str(), "md" | "markdown") {
                "markdown".to_owned()
            } else {
                "text".to_owned()
            },
            page_count: 1,
            blocks: vec![NativeBlock {
                page: 1,
                text,
                confidence: None,
                bounding_box: None,
            }],
            truncated: false,
            ocr_page_count: 0,
            unreadable_page_count: 0,
        }
    } else {
        extract_with_apple(bytes.as_slice(), kind)?
    };
    let format = native.format.clone();
    let page_count = native.page_count;
    let ocr_page_count = native.ocr_page_count;
    let unreadable_page_count = native.unreadable_page_count;
    let (text, evidence, truncated) = normalize_extraction(native)?;
    Ok(DocumentExtractionResponse {
        status: "extracted",
        file_name: Some(file_name),
        format: Some(format),
        file_hash: Some(file_hash),
        byte_count: Some(metadata.len()),
        page_count: Some(page_count),
        ocr_page_count: Some(ocr_page_count),
        unreadable_page_count: Some(unreadable_page_count),
        text: Some(text),
        evidence,
        truncated,
        privacy: "device_only_ephemeral",
    })
}

#[tauri::command]
pub async fn document_extract_select(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<DocumentExtractionResponse, String> {
    runtime.with_unlocked_connection(|_, _| Ok(()))?;
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "Screenshot, PDF or text",
            &[
                "pdf", "png", "jpg", "jpeg", "heic", "heif", "tif", "tiff", "md", "markdown", "txt",
            ],
        )
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(DocumentExtractionResponse {
            status: "cancelled",
            file_name: None,
            format: None,
            file_hash: None,
            byte_count: None,
            page_count: None,
            ocr_page_count: None,
            unreadable_page_count: None,
            text: None,
            evidence: Vec::new(),
            truncated: false,
            privacy: "device_only_ephemeral",
        });
    };
    let path = selected
        .into_path()
        .map_err(|_| "Selected document is not a local file path.".to_owned())?;
    let response = tauri::async_runtime::spawn_blocking(move || extract_path(&path))
        .await
        .map_err(|_| "Local document extraction task failed.".to_owned())??;
    runtime.with_unlocked_connection(|_, _| Ok(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    fn scanned_pdf_fixture() -> Vec<u8> {
        const SCALE: usize = 18;
        const GLYPH_WIDTH: usize = 5;
        const GLYPH_HEIGHT: usize = 7;
        const TEXT: &str = "FOLIO 368";
        let glyph = |character| match character {
            'F' => [
                "11111", "10000", "10000", "11110", "10000", "10000", "10000",
            ],
            'O' => [
                "01110", "10001", "10001", "10001", "10001", "10001", "01110",
            ],
            'L' => [
                "10000", "10000", "10000", "10000", "10000", "10000", "11111",
            ],
            'I' => [
                "11111", "00100", "00100", "00100", "00100", "00100", "11111",
            ],
            '3' => [
                "11110", "00001", "00001", "01110", "00001", "00001", "11110",
            ],
            '6' => [
                "01110", "10000", "10000", "11110", "10001", "10001", "01110",
            ],
            '8' => [
                "01110", "10001", "10001", "01110", "10001", "10001", "01110",
            ],
            _ => [
                "00000", "00000", "00000", "00000", "00000", "00000", "00000",
            ],
        };
        let padding = 36;
        let character_advance = (GLYPH_WIDTH + 2) * SCALE;
        let width = padding * 2 + TEXT.chars().count() * character_advance;
        let height = padding * 2 + GLYPH_HEIGHT * SCALE;
        let mut pixels = vec![255_u8; width * height];
        for (index, character) in TEXT.chars().enumerate() {
            for (row, pattern) in glyph(character).iter().enumerate() {
                for (column, value) in pattern.bytes().enumerate() {
                    if value != b'1' {
                        continue;
                    }
                    for y in 0..SCALE {
                        for x in 0..SCALE {
                            let pixel_x = padding + index * character_advance + column * SCALE + x;
                            let pixel_y = padding + row * SCALE + y;
                            pixels[pixel_y * width + pixel_x] = 0;
                        }
                    }
                }
            }
        }

        let content = format!("q\n{} 0 0 {} 36 72 cm\n/Im0 Do\nQ\n", width, height);
        let mut pdf = b"%PDF-1.4\n%\xff\xff\xff\xff\n".to_vec();
        let mut offsets = vec![0_usize];
        let mut append_object = |number: usize, body: &[u8]| {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{number} 0 obj\n").as_bytes());
            pdf.extend_from_slice(body);
            pdf.extend_from_slice(b"\nendobj\n");
        };
        append_object(1, b"<< /Type /Catalog /Pages 2 0 R >>");
        append_object(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
        append_object(
            3,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] \
                 /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
                width + 72,
                height + 144
            )
            .as_bytes(),
        );
        append_object(
            4,
            format!(
                "<< /Length {} >>\nstream\n{}endstream",
                content.len(),
                content
            )
            .as_bytes(),
        );
        let mut image_object = format!(
            "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} \
             /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {} >>\nstream\n",
            pixels.len()
        )
        .into_bytes();
        image_object.extend_from_slice(&pixels);
        image_object.extend_from_slice(b"\nendstream");
        append_object(5, &image_object);
        let xref_offset = pdf.len();
        pdf.extend_from_slice(b"xref\n0 6\n0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n")
                .as_bytes(),
        );
        pdf
    }

    #[test]
    fn document_magic_must_match_the_allowed_extension() {
        assert_eq!(document_kind("statement.pdf", b"%PDF-1.7").expect("pdf"), 1);
        assert_eq!(
            document_kind("receipt.png", b"\x89PNG\r\n\x1a\nrest").expect("png"),
            2
        );
        assert!(document_kind("receipt.png", b"%PDF-1.7").is_err());
        assert_eq!(
            document_kind("financial-summary.md", b"# Accounts\n- Salary").expect("markdown"),
            3
        );
        assert_eq!(document_kind("notes.txt", b"plain text").expect("text"), 3);
        assert!(document_kind("notes.txt", b"plain\0text").is_err());
        assert!(document_kind("notes.txt", &[0xff, 0xfe]).is_err());
    }

    #[test]
    fn markdown_normalization_preserves_reviewable_text_and_caps_content() {
        let native = NativeExtraction {
            format: "markdown".to_owned(),
            page_count: 1,
            truncated: false,
            ocr_page_count: 0,
            unreadable_page_count: 0,
            blocks: vec![NativeBlock {
                page: 1,
                text: "# 账户\n- 招商银行工资账户：8600 元".to_owned(),
                confidence: None,
                bounding_box: None,
            }],
        };
        let (text, evidence, truncated) =
            normalize_extraction(native).expect("markdown should normalize");
        assert_eq!(text, "# 账户\n- 招商银行工资账户：8600 元");
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].page, 1);
        assert_eq!(evidence[0].confidence_bps, None);
        assert!(!truncated);
    }

    #[test]
    fn extraction_normalization_preserves_page_ranges_and_caps_text() {
        let native = NativeExtraction {
            format: "image".to_owned(),
            page_count: 1,
            truncated: false,
            ocr_page_count: 1,
            unreadable_page_count: 0,
            blocks: vec![
                NativeBlock {
                    page: 1,
                    text: "招商银行".to_owned(),
                    confidence: Some(0.98),
                    bounding_box: Some(NativeBox {
                        x: 0.1,
                        y: 0.8,
                        width: 0.4,
                        height: 0.1,
                    }),
                },
                NativeBlock {
                    page: 1,
                    text: "支出 368 元".to_owned(),
                    confidence: Some(0.9),
                    bounding_box: None,
                },
            ],
        };
        let (text, evidence, truncated) =
            normalize_extraction(native).expect("evidence should normalize");
        assert_eq!(text, "招商银行\n支出 368 元");
        assert_eq!((evidence[0].range_start, evidence[0].range_end), (0, 4));
        assert_eq!((evidence[1].range_start, evidence[1].range_end), (5, 13));
        assert_eq!(evidence[0].confidence_bps, Some(9800));
        assert!(!truncated);
    }

    #[test]
    fn invalid_bounding_boxes_are_removed_from_evidence() {
        let native = NativeExtraction {
            format: "image".to_owned(),
            page_count: 1,
            truncated: false,
            ocr_page_count: 1,
            unreadable_page_count: 0,
            blocks: vec![NativeBlock {
                page: 1,
                text: "有效文字".to_owned(),
                confidence: None,
                bounding_box: Some(NativeBox {
                    x: -1.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                }),
            }],
        };
        let (_, evidence, _) = normalize_extraction(native).expect("evidence should normalize");
        assert!(evidence[0].bounding_box.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an unsandboxed Apple Vision runtime; run explicitly before release"]
    fn scanned_pdf_pages_are_ocrd_locally_with_page_evidence() {
        let fixture = scanned_pdf_fixture();
        let extraction = extract_with_apple(&fixture, 1)
            .expect("a raster-only fictional PDF should be recognized by Vision");
        let recognized = extraction
            .blocks
            .iter()
            .map(|block| block.text.replace(' ', "").to_ascii_uppercase())
            .collect::<String>();
        assert_eq!(extraction.format, "pdf");
        assert_eq!(extraction.page_count, 1);
        assert!(
            recognized.contains("FOLIO") || recognized.contains("368"),
            "unexpected OCR result: {recognized}"
        );
        assert!(extraction.blocks.iter().all(|block| block.page == 1));
        assert!(extraction
            .blocks
            .iter()
            .any(|block| block.confidence.is_some() && block.bounding_box.is_some()));
    }
}
