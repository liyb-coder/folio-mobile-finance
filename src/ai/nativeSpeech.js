const STATUS_MESSAGES = Object.freeze({
  microphone_denied: "麦克风权限未授权；可在系统设置中允许 Folio 使用麦克风。",
  speech_denied: "语音识别权限未授权；可在系统设置中允许 Folio 使用语音识别。",
  on_device_unavailable: "当前设备或语言不支持离线语音识别；为保护隐私，Folio 不会降级上传音频。",
  unavailable: "设备语音识别服务当前不可用，请稍后重试或直接输入文字。",
  audio_unavailable: "没有检测到可用的麦克风输入。",
  no_speech: "本次没有识别到清晰语音，请重试或直接输入文字。",
  recognition_failed: "设备内语音识别未完成，请重试或直接输入文字。",
  unsupported_os: "当前系统版本不支持 Folio 的设备内语音识别。",
});

export function requireNativeSpeechText(response) {
  if (response?.status === "transcribed" && response.onDevice === true) {
    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (text && text.length <= 4000) return text;
  }
  const message = STATUS_MESSAGES[response?.status]
    ?? "设备内语音识别没有返回可核对文字。";
  throw new Error(message);
}
