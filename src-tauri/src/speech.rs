use crate::vault::VaultRuntime;
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::ipc::{Channel, JavaScriptChannelId};

const DEFAULT_LOCALE: &str = "zh-CN";
const MIN_RECORDING_SECONDS: u8 = 3;
const MAX_RECORDING_SECONDS: u8 = 30;

#[derive(Default)]
pub struct SpeechRuntime {
    active: Arc<AtomicBool>,
}

struct ActiveSpeechGuard(Arc<AtomicBool>);

impl Drop for ActiveSpeechGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscriptionRequest {
    locale: Option<String>,
    max_seconds: Option<u8>,
    confirmed_by_user: bool,
    on_event: Option<JavaScriptChannelId>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscriptionResponse {
    status: String,
    text: Option<String>,
    locale: Option<String>,
    on_device: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStreamEvent {
    kind: String,
    text: Option<String>,
    level: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStopResponse {
    status: String,
    requested: bool,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
struct SpeechEventEmitter {
    channel: Channel<SpeechStreamEvent>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
unsafe extern "C" fn emit_apple_speech_event(
    kind: *const std::os::raw::c_char,
    text: *const std::os::raw::c_char,
    level: f32,
    context: *mut c_void,
) {
    use std::ffi::CStr;

    if kind.is_null() || context.is_null() {
        return;
    }
    let emitter = unsafe { &*(context.cast::<SpeechEventEmitter>()) };
    let kind = unsafe { CStr::from_ptr(kind) }
        .to_string_lossy()
        .into_owned();
    let text = if text.is_null() {
        None
    } else {
        let value = unsafe { CStr::from_ptr(text) }
            .to_string_lossy()
            .trim()
            .to_owned();
        (!value.is_empty()).then_some(value)
    };
    let level = (kind == "level").then_some(level.clamp(0.0, 1.0));
    let _ = emitter.channel.send(SpeechStreamEvent { kind, text, level });
}

fn normalize_request(request: SpeechTranscriptionRequest) -> Result<(String, u8), String> {
    if !request.confirmed_by_user {
        return Err("Explicit consent is required before microphone access.".to_owned());
    }
    let locale = request
        .locale
        .unwrap_or_else(|| DEFAULT_LOCALE.to_owned())
        .trim()
        .to_owned();
    if locale.is_empty()
        || locale.len() > 20
        || !locale
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Speech locale is invalid.".to_owned());
    }
    let max_seconds = request.max_seconds.unwrap_or(12);
    if !(MIN_RECORDING_SECONDS..=MAX_RECORDING_SECONDS).contains(&max_seconds) {
        return Err("Speech recording must last between 3 and 30 seconds.".to_owned());
    }
    Ok((locale, max_seconds))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn transcribe_on_apple(
    locale: &str,
    max_seconds: u8,
    on_event: Option<Channel<SpeechStreamEvent>>,
) -> Result<SpeechTranscriptionResponse, String> {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_float};

    type SpeechEventCallback = unsafe extern "C" fn(
        kind: *const c_char,
        text: *const c_char,
        level: c_float,
        context: *mut c_void,
    );

    unsafe extern "C" {
        fn folio_speech_transcribe_once(
            locale: *const c_char,
            max_seconds: u32,
            callback: Option<SpeechEventCallback>,
            context: *mut c_void,
        ) -> *mut c_char;
        fn folio_speech_free(value: *mut c_char);
    }

    let locale = CString::new(locale).map_err(|_| "Speech locale is invalid.".to_owned())?;
    let mut emitter = on_event.map(|channel| SpeechEventEmitter { channel });
    let context = emitter
        .as_mut()
        .map_or(std::ptr::null_mut(), |value| {
            std::ptr::from_mut(value).cast::<c_void>()
        });
    let callback = emitter
        .as_ref()
        .map(|_| emit_apple_speech_event as SpeechEventCallback);
    let response_pointer = unsafe {
        folio_speech_transcribe_once(
            locale.as_ptr(),
            u32::from(max_seconds),
            callback,
            context,
        )
    };
    if response_pointer.is_null() {
        return Err("The device speech recognizer returned no result.".to_owned());
    }
    let response_json = unsafe {
        let value = CStr::from_ptr(response_pointer)
            .to_string_lossy()
            .into_owned();
        folio_speech_free(response_pointer);
        value
    };
    let mut response: SpeechTranscriptionResponse = serde_json::from_str(&response_json)
        .map_err(|_| "The device speech recognizer returned an invalid result.".to_owned())?;
    if response.status == "transcribed" {
        let text = response.text.take().unwrap_or_default().trim().to_owned();
        if text.is_empty() || text.chars().count() > 4_000 {
            return Err("No reviewable speech text was recognized.".to_owned());
        }
        response.text = Some(text);
        response.locale = Some(locale.to_string_lossy().into_owned());
        response.on_device = true;
    }
    Ok(response)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn stop_on_apple() -> bool {
    use std::os::raw::c_int;

    unsafe extern "C" {
        fn folio_speech_stop_current() -> c_int;
    }

    unsafe { folio_speech_stop_current() == 1 }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn stop_on_apple() -> bool {
    false
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn transcribe_on_apple(
    _locale: &str,
    _max_seconds: u8,
    _on_event: Option<Channel<SpeechStreamEvent>>,
) -> Result<SpeechTranscriptionResponse, String> {
    Err("On-device speech recognition is not implemented for this platform.".to_owned())
}

#[tauri::command]
pub async fn speech_transcribe_once<R: tauri::Runtime>(
    mut request: SpeechTranscriptionRequest,
    webview: tauri::Webview<R>,
    vault_runtime: tauri::State<'_, VaultRuntime>,
    speech_runtime: tauri::State<'_, SpeechRuntime>,
) -> Result<SpeechTranscriptionResponse, String> {
    let on_event = request
        .on_event
        .take()
        .map(|channel_id| channel_id.channel_on(webview));
    let (locale, max_seconds) = normalize_request(request)?;
    vault_runtime.with_unlocked_connection(|_, _| Ok(()))?;
    speech_runtime
        .active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "Another speech transcription is already active.".to_owned())?;
    let active = Arc::clone(&speech_runtime.inner().active);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ActiveSpeechGuard(active);
        transcribe_on_apple(&locale, max_seconds, on_event)
    })
    .await
    .map_err(|_| "The device speech transcription task failed.".to_owned())?
}

#[tauri::command]
pub fn speech_stop_current(
    speech_runtime: tauri::State<'_, SpeechRuntime>,
) -> SpeechStopResponse {
    let active = speech_runtime.active.load(Ordering::Acquire);
    let requested = active && stop_on_apple();
    SpeechStopResponse {
        status: if requested {
            "stop_requested"
        } else {
            "not_active"
        }
        .to_owned(),
        requested,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        locale: Option<&str>,
        max_seconds: Option<u8>,
        confirmed_by_user: bool,
    ) -> SpeechTranscriptionRequest {
        SpeechTranscriptionRequest {
            locale: locale.map(str::to_owned),
            max_seconds,
            confirmed_by_user,
            on_event: None,
        }
    }

    #[test]
    fn speech_requires_explicit_consent_and_bounded_options() {
        assert!(normalize_request(request(None, None, false)).is_err());
        assert_eq!(
            normalize_request(request(None, None, true)).unwrap(),
            ("zh-CN".to_owned(), 12)
        );
        assert!(normalize_request(request(Some("../secret"), None, true)).is_err());
        assert!(normalize_request(request(None, Some(2), true)).is_err());
        assert!(normalize_request(request(None, Some(31), true)).is_err());
    }

    #[test]
    fn speech_response_serialization_never_contains_audio() {
        let response = SpeechTranscriptionResponse {
            status: "transcribed".to_owned(),
            text: Some("虚构语音流水".to_owned()),
            locale: Some("zh-CN".to_owned()),
            on_device: true,
        };
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["text"], "虚构语音流水");
        assert_eq!(value["onDevice"], true);
        assert!(value.get("audio").is_none());
        assert!(value.get("path").is_none());
    }

    #[test]
    fn speech_stream_events_expose_only_text_and_normalized_levels() {
        let partial = serde_json::to_value(SpeechStreamEvent {
            kind: "partial".to_owned(),
            text: Some("今天支出三百元".to_owned()),
            level: None,
        })
        .unwrap();
        assert_eq!(partial["text"], "今天支出三百元");
        assert!(partial.get("audio").is_none());

        let level = serde_json::to_value(SpeechStreamEvent {
            kind: "level".to_owned(),
            text: None,
            level: Some(0.5),
        })
        .unwrap();
        assert_eq!(level["level"], 0.5);
        assert!(level.get("path").is_none());
    }
}
