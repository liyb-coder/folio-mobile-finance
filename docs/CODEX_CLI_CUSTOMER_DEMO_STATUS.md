# Codex CLI customer-demo implementation

Updated: 2026-08-09

## Product decision

- Customer-demo AI uses the local signed-in Codex CLI. Folio never asks for or stores an API key in this phase.
- Raw microphone audio is handled only by Apple on-device speech recognition. Codex receives the resulting text after the user clicks the explicit parse action.
- Apple speech now streams device-side partial text and normalized live input levels to the React UI through a scoped Tauri channel; no audio buffer crosses that bridge.
- Screenshots and PDFs use the existing device-side Vision/PDFKit extraction. Codex receives extracted text, not the original binary.
- Structured Folio Markdown cold start stays deterministic and enters the existing ordered review/confirm workflow.
- Codex only classifies semantic intent and returns exact source quotes. Existing deterministic Folio parsers extract money, dates, accounts, and holdings. Every mutation still requires native draft validation and explicit confirmation.
- Customer presentations use the standalone Tauri `.app`/`.dmg`; no Vite server is required.

## Implemented paths

- `src-tauri/src/codex_cli.rs`: CLI discovery, ChatGPT login status, sanitized environment, private temporary workspace, HTTPS-only Codex provider, structured schema, exact-evidence validation, timeout and fail-closed behavior.
- `src/ai/codexCliProposal.js`: combines Codex classification with deterministic proposal extraction without letting the model invent draft fields.
- `src/NativeVaultApp.jsx`: visible provider status, explicit transfer boundary, voice/file/text integration, and review flow.
- `scripts/check-customer-demo-readiness.mjs`: verifies CLI/login and standalone package availability before a presentation.
- The bridge adapts the isolation rules from `ARCHIHUB_CLI_CONTINUOUS_CONVERSATION_IMPLEMENTATION_PLAN.md`: direct process spawning without a shell, stdin-only user content, an isolated temporary working directory, bounded output, timeout, structured validation, and fail-closed behavior. Folio uses one ephemeral CLI turn per proposal instead of retaining financial conversations.

## Verified facts

- Installed CLIs: ChatGPT-bundled `codex-cli 0.147.0-alpha.6.5`; npm `codex-cli 0.144.1`.
- Both authenticate through the existing ChatGPT login.
- CLI catalog advertises text and image input. Direct image input successfully read the Folio desktop dashboard screenshot.
- The complete CLI command reference exposes `--image` but no raw-audio input flag.
- A real financial intent turn returned schema-valid JSON with an exact source quote.
- On this network, default WebSocket transport took about 120 seconds because of retries. Folio's isolated HTTP-only provider returned the same structured result in about 14 seconds without changing global Codex config.
- JavaScript/domain suite: 228 passed.
- Rust suite: 105 passed, 2 explicitly ignored network/runtime cases; the Apple Vision scanned-PDF case was previously run explicitly and passed.
- Structured Markdown cold-start SQLCipher end-to-end test passed.
- Final macOS package mounted and verified: `Folio_0.1.0_arm64.dmg`, 13,967,542 bytes, SHA-256 `47d341c3988a1ac97846f93029e79e6d6c9507a855f315b07d4142b6e07c4ce8`.
- The packaged application launched successfully from `Folio.app`; `npm run demo:doctor` reports `READY` and confirms no DEV server is required.

## Manual presentation checks

- Before a customer meeting, run one fictional Codex parse on the actual venue network; CLI login alone cannot prove upstream availability.
- Speak one fictional expense to confirm macOS microphone and offline speech permissions on the presentation account.
- Use `docs/demo/Folio_冷启动全量演示数据.md` for the empty-app Markdown walkthrough.
- Use a one-record screenshot/PDF for the current file demo. Multi-record unstructured statements still need a dedicated batch-review UX; do not imply they are already imported automatically.
- Commercialization must replace the local CLI/ChatGPT-account dependency with a production API contract, observability, quotas, and customer data terms.
