# Folio small-fixes handoff — 2026-08-13

## Decisions

- Daily additions and complete-snapshot replacement are separate entry paths.
- Complete replacement requires: export current Markdown → choose/read the new snapshot → current-password reauthentication and destructive acknowledgement → recreate empty local data → dependency-ordered review and explicit confirmation.
- QQ Mail remains a macOS-only, read-only IMAPS source. The UI teaches QQ authorization-code setup and stores credentials in macOS Keychain; parsed transactions remain pending review.
- Local-development model configuration accepts `FOLIO_LLM_*`, `FOLIO_OPENAI_*`, or `OPENAI_*` variables only for an OpenAI Responses API-compatible endpoint.
- Overview trend, allocation, and account cards all navigate to their supporting detail.
- Low-priority pet states are clipped into the capture bar without a floating bubble; high-priority states may show the full companion and message.

## Completed

- Added actionable QQ Mail setup and clearer local-notification copy.
- Added compatible LLM environment-variable fallback in the native gateway.
- Added the full-snapshot replacement/review path.
- Expanded both cold-start demo Markdown files to six months and 26 ledger events.
- Made asset trend and account cards actionable; improved the insufficient-history empty state.
- Reduced pet z-index and anchored low-priority states to the capture surface.
- Added a `native-settings` local preview fixture.

## Verification

- Targeted Node tests: 25 passed.
- Native model gateway tests: 4 passed, 1 paid-network test intentionally ignored.
- Production frontend/Sites build: passed.
- Browser verification: six-month asset trend rendered; account cards are buttons; QQ Mail modal opens; full-reimport intro opens before file selection.

## Next

- Run the full product-path planning session after these seven fixes are accepted.
- The destructive full-reimport path has now passed in `/Applications/Folio E2E.app` with the disposable bundle id `com.beizi.folio.e2e`.
- See `docs/06_ACCEPTANCE_RESULTS.md` for the 2026-08-14 adversarial desktop run, pet anchoring fix, installed App, and DMG checksum.
