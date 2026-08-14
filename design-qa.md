# Planning step-rail separation · Design QA — 2026-08-14

## Comparison target

- Source visual truth: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-e28c820c-424d-4467-a517-d256eead649e.png`, with the user's marked concern that the numbered rail still appeared covered.
- Browser-rendered implementation: `docs/audits/planning-redesign-2026-08-14/27-planning-rail-after-1338x1590.png`.
- Same-size side-by-side evidence: `docs/audits/planning-redesign-2026-08-14/28-planning-rail-source-vs-after-1338x1590.png`.
- Both source and implementation are 1338 × 1590 pixels. The source contains the user's red annotation and different persisted financial values, so this scoped comparison judges the numbered rail, label bounds, card boundary, spacing rhythm, and typography rather than data equality.

## Findings

No actionable P0/P1/P2 issue remains.

- Fonts and typography: the three stage titles keep their existing 14px/strong hierarchy and one-line labels. No type size, financial amount hierarchy, or line-height changed.
- Spacing and layout rhythm: the desktop rail now reserves a non-shrinking 132px track, with 42px reserved for the numbered marker/connector and a 20px default card gap. At the compact desktop breakpoint the rail remains 132px with an 18px card gap instead of shrinking to 102px.
- Colors and visual tokens: the grey connector, lime/lilac/gold stage markers, white planning cards, and charcoal next-step card are unchanged.
- Image quality and asset fidelity: this change adds no asset and modifies no logo, icon, illustration, or pet raster.
- Copy and content: all planning labels, amounts, controls, and safety copy remain unchanged.
- Responsiveness and accessibility: DOM-boundary measurement at 1338px found 54px, 34px, and 50px of clearance between the visible labels and their cards; the compact 1180px breakpoint found 52px, 32px, and 48px. All three stages report `overlaps: false`.
- Browser error check: no warning or error was emitted.

## Comparison history

### Iteration 1

- [P2] The compact desktop rule shrank the rail from 114px to 102px while keeping “未来 12 个月” on one line, allowing the title to overflow its grid track toward the card.
  - Fix: reserve a 132px step track at desktop and compact-desktop widths, move label copy to a 42px inset after the marker, and keep an 18–20px separation before the card.
  - Post-fix evidence: `27-planning-rail-after-1338x1590.png` and `28-planning-rail-source-vs-after-1338x1590.png`.

## Primary interactions tested

- Opened the planning page at 1180 × 1000 and 1338 × 1590 viewports.
- Measured every stage title/description boundary against its adjacent card boundary.
- Opened “添加目标”, verified the “添加未来用款目标” dialog, and closed it successfully.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Quiet-rest pet scale · Design QA — 2026-08-14

## Comparison target

- Source visual truth: `docs/audits/planning-redesign-2026-08-14/18-pet-rest-before-scale.png`, together with the explicit direction that the cat had become too small.
- Browser-rendered implementation: `docs/audits/planning-redesign-2026-08-14/22-pet-rest-final-scale.png`.
- Full-view comparison evidence: `docs/audits/planning-redesign-2026-08-14/23-pet-rest-final-full-comparison.png`.
- Focused comparison evidence: `docs/audits/planning-redesign-2026-08-14/24-pet-rest-final-focused-comparison.png`.
- Source and implementation are both 1280 × 720 pixels from the same 1280 × 720 CSS viewport, `native-film` data, overview screen, and forced quiet-rest state; no density normalization was required.

## Findings

No actionable P0/P1/P2 issue remains.

- Fonts and typography: financial hierarchy and capture-bar copy are unchanged. The restrained staggered Z letters remain legible without becoming a second message layer.
- Spacing and layout rhythm: the rest sprite frame increased from 64 × 52 to 88 × 78 CSS pixels and its raster scale from 64 to 92 pixels. The final 92 × 90 anchor sits behind the 320 × 66 capture bar, with the lower body naturally occluded.
- Colors and visual tokens: the original charcoal cat, lime collar, purple tag, and transparent canvas are preserved without added shadows, cards, gradients, or decorative framing.
- Image quality and asset fidelity: the approved `folio-cat-rest-grooming-static-transparent.png` raster remains the source. The larger scale is still below its native 192 × 192 resolution, so edges remain clean and transparent corners show no halo.
- Copy and content: no financial copy, amounts, status, or capture guidance changed.
- Responsiveness and accessibility: the cat is shifted into nearby whitespace rather than covering the allocation title/subtitle, capture copy, lime entry tile, or microphone. The full pet button retains its accessible label.
- Browser error check: only Vite connection/hot-update and React development informational logs were present; no warning or error was emitted.

## Comparison history

### Iteration 1

- [P1] The quiet-rest sprite rendered at 64px with only about 20px of its face visible above the capture bar, reading as tiny ears rather than the canonical cat.
  - Fix: increased the raster/frame scale and exposed a recognizable face plus upper body while keeping the lower edge behind the capture surface.

### Iteration 2

- [P2] The first enlarged placement reached too far left and could compete with the allocation subtitle.
  - Fix: moved the rest anchor 45px right into the gap before “查看明细”. Post-fix evidence: `24-pet-rest-final-focused-comparison.png`.
- [P2] Pointer capture woke the resting pet before its click handler ran, so the first click could fail to open the inbox.
  - Fix: pet-targeted pointer activity now defers the wake transition to the click handler; one click both wakes the pet and opens the AI inbox.

## Primary interactions tested

- Forced the quiet-rest state and measured the pet frame, anchor, and capture-bar bounds.
- Clicked the resting cat once and verified that the AI 待核对收件箱 opened.
- Verified the drawer close action and reloaded the same rest state.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Asset recent-change treatment · Design QA — 2026-08-14

## Comparison target

- Source visual truth: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-c6add04d-754d-465f-a746-e64703c7cc6d.png`, together with the explicit direction to remove the red-boxed lime bracket treatment while retaining the 24-hour NEW signal.
- Browser-rendered implementation: `docs/audits/planning-redesign-2026-08-14/16-assets-after-row-highlight.png`.
- Focused, side-by-side comparison evidence: `docs/audits/planning-redesign-2026-08-14/17-assets-row-highlight-comparison.png`.
- Source pixels: 2340 × 900. Implementation pixels: 1280 × 720 from a 1280 × 720 CSS viewport. The focused evidence compares normalized two-row identity regions because the user-provided screenshot and the browser viewport use different crops and density.
- State: unlocked fictional `native-film` data; desktop Assets → 资产明细; recent-change labels visible.

## Findings

No actionable P0/P1/P2 issue remains.

- Fonts and typography: institution, account metadata, amount, and action hierarchy remain unchanged; the recent-change label uses a quieter 7px/600-weight treatment without losing the explicit `NEW · 更新` status.
- Spacing and layout rhythm: recently changed rows now use the same flat separators, row height, and alignment as every other financial row. The repeated rounded left brackets and extra per-row top margin are gone.
- Colors and visual tokens: the lime inset stripe and lime-to-lilac row gradient were removed. Only a restrained warm-amber label remains, so lime continues to belong to product actions and brand accents rather than decorative row framing.
- Image quality and asset fidelity: no raster asset, logo, pet state, or Phosphor icon was modified. No placeholder, CSS illustration, or new decorative asset was introduced.
- Copy and content: record names, balances, account types, and the rolling-24-hour label semantics are unchanged.
- Responsiveness and accessibility: each table row remains a full semantic button with the same click target. The first row still opens the accessible “管理账户” dialog; the close action was verified.
- Browser error check: only Vite connection/hot-update and React development informational logs were present; no warning or error was emitted.

## Comparison history

### Iteration 1

- [P1] Repeating rounded lime inset stripes plus a broad lime/lilac gradient made recent rows read as generated decorative cards and visually collided with the institution avatar column.
  - Fix: removed the row-level radius, inset stripe, gradient, and extra margin; restored the standard table divider and transparent row surface.
- [P2] The previous bordered amber capsule competed with the already strong row treatment.
  - Fix: reduced the table-specific badge height, border contrast, type size, and saturation while retaining a legible `NEW` cue.
- Post-fix evidence: `docs/audits/planning-redesign-2026-08-14/16-assets-after-row-highlight.png` and focused comparison `17-assets-row-highlight-comparison.png`.

## Primary interactions tested

- Opened Assets from the desktop sidebar.
- Verified the recently updated rows and unchanged 24-hour labels.
- Opened the first account row and confirmed the “管理账户” dialog still renders; closed it successfully.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Planning journey redesign · Design QA — 2026-08-14

## Comparison target

- Source visual truth: `/Users/liyubei/.codex/generated_images/019ff99c-79a9-7662-84a5-6db9dd53e5f6/exec-4fa68afd-9660-4d28-93c7-b014b7dc2e19.png`.
- Browser-rendered implementation: `docs/audits/planning-redesign-2026-08-14/14-selected-direction-pass4.png`.
- Full-view comparison evidence: `docs/audits/planning-redesign-2026-08-14/11-reference-vs-pass3.png` (pass 3; pass 4 only increases readability without changing layout).
- Focused comparison evidence: `docs/audits/planning-redesign-2026-08-14/13-focused-normalized-pass3.png`.
- Source pixels: 1487 × 1058. Implementation full-page pixels: 1280 × 1065 from a 1280 × 720 CSS viewport. The in-app Browser capture is CSS-pixel normalized despite device pixel ratio 2.
- State: unlocked fictional `native-film` data; desktop planning base state; amounts visible; simulation collapsed for the matched-state capture.
- Density normalization: the implementation was scaled from 1280 × 1065 to the source height of 1058 without cropping for the combined full-view comparison. The focused comparison uses the same normalized scale on both sides.

## Findings

No actionable P0/P1/P2 mismatch remains.

- Fonts and typography: the selected editorial heading, compact Chinese labels, strong exact-money numerals, and dark-card hierarchy are preserved. Pass 4 increases goal, allocation, and next-step copy to practical reading sizes; no clipping or broken wrapping is visible.
- Spacing and layout rhythm: the implementation preserves the source order and anatomy: page heading and dual actions, three numbered horizons, white data cards, right-side charcoal next-step card, and anchored lower-right capture surface. Goal creation now uses the source's full-width row instead of a minor header action.
- Colors and visual tokens: low-saturation grey shell, white cards, charcoal next-step surface, lime status/action, lilac future-goal accents, gold long-term marker, thin borders, and soft elevation match the selected direction and existing Folio tokens.
- Image quality and asset fidelity: the existing Folio raster logo and canonical cat assets remain unchanged and correctly anchored. All UI icons come from the existing Phosphor family; no mock image was replaced with emoji, handcrafted SVG, placeholder imagery, or decorative CSS art.
- Copy and content: product copy now explains a deterministic three-horizon model. Safety amount is user-confirmed rather than inferred from net worth; future goals come from confirmed non-monthly items; property, insurance protection, foreign currency, and unclassified assets are excluded from the long-term denominator. “仅试算，不会交易” and “不是 Folio 推荐” remain visible.
- States and interactions: verified data-basis modal, context-specific add/edit future-goal flow, simulation reveal and preset adjustment, 3/3 progress, planning editor, draft generation, explicit confirmation, and immediate `NEW · 更新` feedback. Simulation values transfer into the review form but do not mutate balances or ledger events.
- Responsiveness and accessibility: the selected 1280px desktop state has no overlap or horizontal clipping. Semantic buttons, dialog labels, field labels, accessible edit-goal names, keyboard-reachable controls, and a native range input are present. Existing 960px/700px breakpoints collapse the next-step card and stage rail without removing primary actions.
- Browser error check: all primary interactions above completed in the in-app Browser without an error surface, blank state, rejected promise UI, or dev-server runtime error. The final production build also completed successfully.

## Comparison history

### Iteration 1

- [P1] Fictional fund, insurance, and property accounts were typed as savings accounts, inflating “可及时支取” from ¥140,960.52 to more than ¥2.2m.
  - Fix: corrected the fixture account types and reloaded the same state. Long-term available funds now deduct the confirmed ¥50,000 floor, ¥40,000 future goals, and ¥4,628.35 liability to show ¥46,332.17.
- [P1] A newly confirmed planning update could be newer than the page's cached clock and temporarily miss its `NEW` label.
  - Fix: daily highlights now evaluate every new snapshot against the current clock while retaining the earliest 24-hour expiry timer.
- [P2] “添加目标” was a compact header action and the goal card was visibly shorter than the selected design.
  - Fix: moved the action into a full-width row below the goal list, matching the selected card anatomy.

### Iteration 2

- [P2] Goal rows, allocation rows, and next-step copy were smaller and denser than the selected visual.
  - Fix: increased row heights and optical text sizes while preserving the existing responsive grid.
- Post-fix evidence: `docs/audits/planning-redesign-2026-08-14/14-selected-direction-pass4.png`.
- No actionable P0/P1/P2 difference remains. Dynamic amount/progress differences from the concept image are intentional: the implementation uses the confirmed fictional ledger instead of decorative mock values.

## Primary interactions tested

- “查看数据口径” opens and closes the deterministic calculation explanation.
- “添加目标” opens “添加未来用款目标”; existing rows open “管理未来用款目标”.
- “开始金额试算” reveals the memory-only simulator; “权益 +5%” advances progress to 3/3.
- “核对规划草稿” transfers the simulated 25% fixed-income / 30% equity allocation into the editor.
- “生成核对草稿” opens the explicit-confirm review, and confirmation returns to the page without changing ledger balances.
- A confirmed planning update immediately shows `NEW · 更新`; the helper removes it exactly at the rolling 24-hour boundary.

## Follow-up polish

- [P3] At a wider 1490px native window the stage cards naturally approach the selected mock's more generous proportions; the required in-app Browser viewport was 1280px, so the comparison preserves the responsive, narrower layout rather than forcing fixed widths.

final result: passed

---

# Folio V2 native workspace restoration · Design QA

## Comparison target

- Source visual truth:
  - `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-29eba9a4-4419-4b2f-8590-d7caa62cab32.png` (2026-07-23 AI 管家参考图)
  - `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-685b60d1-5435-42a3-afbc-6ed3f7f66262.png` (AI 管家移动端中央录入入口缺失的问题截图)
  - `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-40170140-aec2-483c-998d-7dd47368d186.png` (overview analytics reference)
  - `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-cbd4efea-f819-4950-9d18-23d8de4bff90.png` (cashflow analytics reference)
  - `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-329f6339-759a-42f4-8fab-00254a321c36.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/folio-v2-mobile.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/folio-v2-desktop.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/folio-v2-mobile-assets.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/folio-v2-mobile-reminders.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/public/assets/pet/folio-cat-actions-spritesheet.png`
  - `/Users/liyubei/代码/codex/12 财务驾驶舱/public/assets/pet/folio-cat-welcome-paw-spritesheet-v2.png`
- Same-viewport source captures from the preserved Folio V2 preview:
  - `docs/audits/native-v2-integration-2026-07-30/source-live-overview-532x921.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/source-live-assets-532x921.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/source-live-reminders-532x921.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/source-live-desktop-1280x720.jpg`
- Browser-rendered implementation:
  - `design-audit/ai-manager-mvp-2026-07-31/implementation-1828x836.png`
  - `design-audit/ai-manager-mvp-2026-07-31/mobile-390x844.png`
  - `design-audit/ai-manager-mvp-2026-07-31/mobile-ai-nav-with-center-capture.png`
  - `.folio-private/qa/overview-implementation-final.png`
  - `.folio-private/qa/cashflow-implementation.png`
  - `docs/audits/native-v2-integration-2026-07-30/10-native-mobile-overview-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/11-native-mobile-assets-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/12-native-mobile-reminders-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/13-native-desktop-overview-final.jpg`
  - `docs/audits/cat-ai-inbox-2026-07-30/desktop-idle-1280x720.png`
  - `docs/audits/cat-ai-inbox-2026-07-30/desktop-welcome-postfix-1280x720.png`
  - `docs/audits/cat-ai-inbox-2026-07-30/desktop-inbox-1280x720.png`
  - `docs/audits/cat-ai-inbox-2026-07-30/mobile-inbox-390x844.png`
- Full-view combined comparison evidence:
  - `design-audit/ai-manager-mvp-2026-07-31/source-vs-implementation.png`
  - `.folio-private/qa/overview-comparison-final.png`
  - `.folio-private/qa/cashflow-comparison.png`
  - `docs/audits/native-v2-integration-2026-07-30/compare-overview-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/compare-assets-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/compare-reminders-final.jpg`
  - `docs/audits/native-v2-integration-2026-07-30/compare-desktop-final.jpg`
- Focused cat-asset comparison evidence:
  - `docs/audits/cat-ai-inbox-2026-07-30/compare-cat-idle-1280x720.png`
  - `docs/audits/cat-ai-inbox-2026-07-30/compare-welcome-paw-postfix-1280x720.png`
- Focused mobile-navigation comparison evidence:
  - `design-audit/ai-manager-mvp-2026-07-31/mobile-nav-source-vs-fixed.png`

## Capture normalization

- Mobile source and implementation pixels: 532 × 921.
- Mobile CSS viewport: 532 × 921 CSS px.
- Desktop source and implementation pixels: 1280 × 720.
- Desktop CSS viewport: 1280 × 720 CSS px.
- Cat action source pixels: 1536 × 1024; welcome-paw source pixels: 1254 × 1254. The implementation renders the action crop at 108 × 108 CSS px and the welcome-paw crop at 96 × 138 CSS px without stretching the source frame.
- AI inbox mobile implementation pixels/CSS viewport: 390 × 844 at device scale factor 1.
- Mobile AI navigation issue source pixels: 1040 × 1844. Fixed implementation pixels/CSS viewport: 390 × 844 at device scale factor 1. The focused comparison scales both bottom-navigation crops to 780 px wide; it is used only to verify slot anatomy and persistent-action visibility, not typography size.
- Device scale factor: 1.
- Density normalization: none required for the live source/implementation comparisons because both sides were captured in the same browser, viewport, and density. The original 522 × 900 and 390 × 844 references remain unchanged and were used as supporting art-direction evidence.
- States: light theme; unlocked local-vault overview; asset details; reminder managers; desktop-pet welcome/idle; desktop and mobile AI inbox; amounts visible; real local-fixture content in the implementation.

## Findings

No actionable P0/P1/P2 mismatch remains.

- Fonts and typography: the native workspace now uses the same compact Chinese UI hierarchy, strong net-worth numerals, small supporting labels, and restrained card headings as Folio V2. Long dynamic reminder copy wraps without collision. The implementation’s exact-money decimals are an intentional data-integrity difference, not typography drift.
- Spacing and layout rhythm: mobile header, lilac net-worth card, charcoal AI focus card, two-column metric grid, persistent five-slot navigation, asset table, and stacked reminder managers follow the same order, density, radii, and gaps as the source. Desktop restores the same sidebar width, two-card hero row, four-card metric row, and lower content panel rhythm.
- Colors and visual tokens: low-saturation grey shell, lilac hero, charcoal focus surface, lime actions/status, restrained purple accents, white panels, fine borders, and soft shadows map to the existing Folio V2 tokens.
- Image quality and asset fidelity: the selected Folio logo, cat action sheet, and welcome-paw sheet remain raster assets at appropriate sizes. The companion uses source-image crops rather than CSS drawings; the welcome paw keeps the generated frame ratio and exposes the pink pads without stretching. Phosphor icons are used consistently; no visible source asset was replaced with CSS art, emoji, placeholder imagery, or a handcrafted SVG.
- Copy and content: labels are concise and product-specific. The reminder primary action is “添加事项”; its modal explicitly states that it will not generate or send collection copy. Local-vault status copy accurately says “仅保存在此 Mac”.
- Responsiveness: no horizontal overflow, clipping, or persistent-control overlap was observed at 390 × 844, 532 × 921, or 1280 × 720. The center voice entry remains visible and reachable on every mobile module, including AI 管家; the full desktop pet is intentionally hidden below 840 px and the mobile AI 管家 retains a dedicated inbox entry.
- Accessibility and states: primary actions use semantic buttons and accessible labels, mobile tap targets remain practical, and keyboard focus treatment is visible. Add-account, add-reminder, and AI-input dialogs remain usable after the visual migration.
- Focused-region evidence: separate asset and reminder comparisons were required because their tabs, filters, row density, manager cards, icons, and action labels are too small to judge reliably from the overview comparison. The desktop-pet action and welcome-paw crops were also compared in the same image as their source sheets; all focused comparisons are listed above.

## Comparison history

### Iteration 1

- [P1] The native workspace overview still used a separate secure-vault card language rather than the selected Folio V2 hierarchy.
  - Fix: rebuilt the native overview with the V2 net-worth card, AI focus card, metric grid, account panel, mobile header, sidebar, and contextual voice composer while retaining live local data.
  - Post-fix evidence: `10-native-mobile-overview-final.jpg`, `13-native-desktop-overview-final.jpg`.
- [P1] Assets rendered as a dense management workspace and did not resemble the V2 asset screen.
  - Earlier evidence: `03-native-mobile-assets-v1.jpg`.
  - Fix: restored the lilac total card, three-section tabs, compact category filters, V2 account rows, and contextual add-account entry; the detailed holding tools remain under “产品表现”.
  - Post-fix evidence: `04-native-mobile-assets-v2.jpg`, `11-native-mobile-assets-final.jpg`.
- [P1] Reminders rendered as a generic list and did not preserve the three-manager visual model.
  - Earlier evidence: `05-native-mobile-reminders-v1.jpg`.
  - Fix: restored the next-node hero plus rent, insurance, and maturity manager cards, while retaining the full auditable schedule below.
  - Post-fix evidence: `06-native-mobile-reminders-v2.jpg`, `12-native-mobile-reminders-final.jpg`.
- [P2] Cashflow still looked like an oversized local admin card and broke the restored page rhythm.
  - Earlier evidence: `07-native-mobile-cashflow-v1.jpg`.
  - Fix: moved totals into the V2 metric cards and wrapped the immutable ledger rows in the standard Folio panel treatment.
  - Post-fix evidence: `08-native-mobile-cashflow-v2.jpg`.

### Iteration 2

- Captured the preserved Folio V2 preview and the integrated native workspace at identical mobile and desktop viewports.
- Placed each source and implementation pair into a single comparison image.
- Rechecked typography, spacing, colors, image assets, app copy, icons, dynamic data states, and responsive structure.
- No further actionable P0/P1/P2 difference was found. Remaining differences are expected real-data/state differences: the local fixture has two accounts rather than five, some reminder managers are empty, and financial amounts preserve exact decimals.

### Iteration 3

- [P2] The first cold-start crop used the bottom of the portrait paw frame, so the implementation showed mostly forearm and only a sliver of the pink pads.
  - Earlier evidence: `docs/audits/cat-ai-inbox-2026-07-30/desktop-welcome-1280x720.png`.
  - Fix: retained the portrait source ratio and moved all three sprite-frame crops to the 42% vertical focal point instead of stretching or bottom-aligning the sheet.
  - Post-fix evidence: `docs/audits/cat-ai-inbox-2026-07-30/desktop-welcome-postfix-1280x720.png` and `docs/audits/cat-ai-inbox-2026-07-30/compare-welcome-paw-postfix-1280x720.png`.
- Rechecked the idle tail crop, fixed welcome paw, inbox drawer, mobile full-screen inbox, typography, spacing, palette, image sharpness, copy, and persistent-action reachability. No actionable P0/P1/P2 issue remains.

### Iteration 4

- Added the real QQ Mail data-source entry to security settings using the existing white-card, charcoal-action, lilac/lime icon language.
- Added the configuration/review modal at desktop and 390 × 844: email, authorization code, account mapping, mailbox, sender whitelist, subject keywords, read-only consent, connection test, sync result, and per-item confirm/reject.
- [P1] The browser fixture has no native repository, so the first preview surfaced a raw JavaScript null-reference error inside the modal.
  - Fix: preview mode now renders the form without an internal error and keeps the native-only save action unavailable.
- [P2] The disabled mobile save action had insufficient contrast.
  - Fix: added an explicit grey disabled state with readable label.
- No horizontal overflow or clipped form control was observed. The modal remains scrollable and the authorization boundary is visible before submission.

### Iteration 5

- Added the two analytical modules missing from the data-backed overview: a six-month asset trend and a current allocation donut with exact amounts and percentages.
- Added the cashflow reference anatomy: monthly income, monthly expense, net cashflow, a six-month dual-line trend, and the ledger list. The final implementation reads only confirmed transactions; when no records exist, it shows a real empty/zero state and never substitutes `analyticsPreview` data.
- [P1] The first asset-trend render inherited a zero-based Y axis, which visually flattened the relatively narrow movement between ¥3.12m and ¥3.35m.
  - Fix: derive a padded local Y-axis domain from the six supplied valuation points. The final chart now preserves meaningful month-to-month shape without changing any values.
- [P2] The earlier rest loop continuously moved the cat body and competed with financial content.
  - Fix: rest now uses one static transparent cat frame at 86 × 86 CSS px. Only three small purple “Z” letters fade upward; hover no longer moves the sleeping cat, and reduced-motion mode makes the letters static.
- Desktop reference and implementation were viewed in the same combined comparison images. The overview preserves the two-column hero, four metric cards, and trend/allocation split; cashflow preserves the three metrics, dominant dual-line chart, and transaction list hierarchy while retaining the current Folio V2 design tokens.
- Responsive verification at 390 × 844 found no horizontal overflow. Analytics cards become single-column, the chart viewport remains 366 px wide, the desktop pet is hidden, and the centered mobile capture action remains reachable.
- Browser console errors after clean reload: none.

### Iteration 6

- Removed all product-facing “保险库” copy from `src/`; security remains an implementation detail behind “本地数据” and “应用密码”.
- Replaced the first-phase data-management surface with structured Markdown import, structured Markdown export, and authenticated clear. The export is round-trip tested against the existing cold-start parser and reverses confirmed transaction effects when rebuilding opening balances, preventing historical cashflow replay.
- Removed the `analyticsPreview` fallback from overview and cashflow so display fixtures can no longer appear as real ledger data.
- Rebuilt AI 管家 from the July 23 reference at the same 1828px width. The final implementation matches the source’s 1050px centered content column, grey-lilac hero, lime assistant mark, large natural-language headline, white capture bar, three capability cards, and quiet confirmation strip.
- [P1] The first implementation stretched the assistant content to the full workspace width.
  - Fix: constrained the assistant workspace to the source’s 1050px content column and recaptured the same viewport.
- [P1] The desktop pet rendered as a separate floating tail/toast over the AI page’s confirmation strip.
  - Fix: the assistant page now owns capture without an extra pet layer; other desktop modules retain the pet and lower-right composer as one anchored interaction system.
- Settings now places Markdown data management directly after device security. The three data actions use a two-column grid so the fixed capture dock does not cover the destructive clear action.
- Mobile verification at 390 × 844: no horizontal overflow (`scrollWidth = clientWidth = 390`); the persistent AI navigation remains reachable and the desktop pet stays absent.

### Iteration 7

- [P1] Entering AI 管家 replaced the persistent center “记一笔” action with an invisible spacer, leaving only four visible bottom-navigation actions and breaking the cross-module capture model.
  - Earlier evidence: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-685b60d1-5435-42a3-afbc-6ed3f7f66262.png`.
  - Fix: removed the assistant-only conditional and spacer. The five-slot navigation now always renders the center voice action; the in-page AI composer remains complementary rather than replacing the global capture entry.
  - Post-fix evidence: `design-audit/ai-manager-mvp-2026-07-31/mobile-ai-nav-with-center-capture.png` and `design-audit/ai-manager-mvp-2026-07-31/mobile-nav-source-vs-fixed.png`.
- Verified at 390 × 844 that AI 管家 remains active, all five navigation buttons are present, the center action is visible, and `scrollWidth = clientWidth = 390`.
- Clicked the center action from AI 管家 and verified that the unified modal opens with “语音”, “截图 / 文档”, and “文字” tabs.
- No actionable P0/P1/P2 difference remains after the focused navigation comparison.

### Iteration 8

- [P1] AI 管家在桌面端完全没有出现已选定的灰黑色猫桌宠。根因是页面分支明确排除了 `FolioDeskPet`，因此无论桌宠素材和状态机是否正常，切入 AI 管家后都会消失。
  - 修复前证据：`design-audit/mvp-product-audit-2026-08-02/03-ai-assistant-before-no-pet.png`。
  - 修复：保留 AI 管家自己拥有的页面内语音框，把同一个桌宠状态机作为内嵌伙伴锚定在输入框右侧；不新增第二个悬浮语音框，也不遮挡确认防线或财务内容。
  - 修复后证据：`design-audit/mvp-product-audit-2026-08-02/04-ai-assistant-after-inline-pet.png`。
- 在相同的 1280 × 720 CSS 视口中生成全屏与焦点前后对比：`design-audit/mvp-product-audit-2026-08-02/07-ai-pet-before-after-full.png`、`design-audit/mvp-product-audit-2026-08-02/08-ai-pet-before-after-focus.png`。前后截图使用相同浏览器、设备像素密度和页面状态，无需额外密度归一化。
- 点击内嵌桌宠后，确认其打开“AI 待核对收件箱”，没有直接写入账本；交互证据：`design-audit/mvp-product-audit-2026-08-02/05-ai-pet-opens-inbox.png`。
- 在 390 × 844 复查响应式状态：桌面桌宠运行时不加载，页面内语音框与底部居中的“记一笔”仍同时可见，`scrollWidth = clientWidth = 390`；证据：`design-audit/mvp-product-audit-2026-08-02/06-mobile-assistant-after.png`。
- 修复后未发现新的 P0/P1/P2 视觉或交互问题。

## Primary interactions tested

- “添加账户” opens the context-specific account form instead of a toast or inert action.
- The asset-page center voice entry opens the AI inbox without writing data directly.
- “添加事项” opens the correct reminder form and uses item-management language.
- Asset tabs, category filters, account management rows, desktop sidebar, mobile drawer, and bottom navigation remain reachable.
- The desktop pet opens the read-only AI inbox; welcome transitions to idle, and AI parse states drive processing/ready/needs-input/completed feedback without confirming financial changes.
- At 390 × 844 the desktop pet is absent, the center capture button remains clear, and “AI 管家 → 待核对收件箱” opens the mobile inbox.
- At 390 × 844 the AI 管家 page keeps the center “记一笔” action; activating it opens the same three-method capture flow used by every other module.
- At 1280 × 720 the AI 管家 page shows the canonical cat next to its in-page composer; activating it opens the pending-review inbox without creating a financial mutation.
- Browser page logs were checked after clean reloads; no application errors were present.
- `npm test`: 222/222 passed.
- Rust backend tests: 98/98 passed; 2 release-environment tests ignored.
- `npm run test:sites`: 4/4 passed.
- `npm run build`: passed and emitted the required Sites handoff files.

## Follow-up polish

- [P3] The active bottom-navigation focus outline is intentionally retained for keyboard accessibility; on pointer interaction it may appear slightly stronger than the static source image.
- [P3] Route-level code splitting can reduce the existing large-bundle warning after the MVP visual baseline is stable.

final result: passed

---

# Unframed Voice Capture QA — 2026-08-10

## Evidence

- Source visual truth: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-b3020fb4-17ea-4b8c-bce9-cb8cd0f80ce0.png`.
- Source pixels: 1774 × 1450.
- Intended implementation URL: `http://127.0.0.1:5173/?vault-preview=workspace`.
- Intended viewport/state: desktop, idle unified voice capture modal, 1280 × 720 CSS px, device scale factor 1.
- Browser-rendered implementation screenshot: unavailable. The Codex in-app browser rejected local URL control under its URL safety policy, so no compliant implementation capture could be produced in this run.
- Density normalization: not applicable until an implementation screenshot exists.

## Findings

- [P1] Browser visual comparison is blocked.
  - Location: unified voice capture modal, idle state.
  - Evidence: the source screenshot was opened at 1774 × 1450, but the local implementation could not be captured through the required in-app browser surface.
  - Impact: typography, spacing, waveform contrast, modal height, and button placement cannot be truthfully marked visually passed from code and build output alone.
  - Fix: refresh the already-open local preview in an allowed browser session, capture the idle modal at 1280 × 720, and compare it with the source in one combined image.

- Implemented code-level changes awaiting visual confirmation:
  - Removed the redundant `local-ai-privacy-line` footnote above the modal actions.
  - Replaced the dark inset `local-ai-voice-card` treatment with an unframed transparent `local-ai-voice-stage` on the modal canvas.
  - Remapped idle text to charcoal/grey, retained lime and purple waveform accents, and changed the central microphone to the existing charcoal/lime Folio control language.
  - Preserved live partial text, animated waveform, explicit “结束并核对” state, editable final transcript, and responsive mobile rules.

## Required Fidelity Surfaces

- Fonts and typography: code tokens preserve the existing Folio hierarchy; browser evidence is blocked.
- Spacing and layout rhythm: the stage is widened to 500px, unframed, and vertically compacted; browser evidence is blocked.
- Colors and visual tokens: charcoal, lime, lilac/purple, grey, and transparent modal canvas values are present in CSS; browser evidence is blocked.
- Image quality and asset fidelity: no new raster asset is required; the existing real-time canvas waveform and Phosphor microphone/stop icons remain in use. Browser sharpness evidence is blocked.
- Copy and content: the requested safety footnote is absent; example/live text, device status, and action labels remain.

## Comparison History

### Iteration 1

- Removed the dark framed surface and redundant safety footnote.
- Added static source assertions for the unframed transparent stage and retained interaction controls.
- `npm test`: passed.
- `npm run build`: passed and emitted the Sites-ready client/server artifacts.
- Browser interaction and console inspection: blocked by the in-app browser local-URL policy before a DOM snapshot or screenshot could be captured.

## Implementation Checklist

- [x] Remove the redundant footnote.
- [x] Remove the dark voice-card frame and shadow.
- [x] Place text, waveform, microphone, and device status directly on the modal canvas.
- [x] Preserve recording, stop, review, and parse behavior.
- [x] Pass source assertions, full frontend tests, and production build.
- [ ] Capture and compare the rendered idle/review states in an allowed browser session.
- [ ] Inspect browser console and responsive layout after the visual capture.

## Focused Comparison

- Required because the waveform contrast, text hierarchy, and microphone placement are the acceptance target, but blocked because no browser-rendered implementation crop could be produced.

final result: blocked

---

# Final Folio Logo QA — 2026-08-09

## Evidence

- Source visual truth: `/Users/liyubei/.codex/generated_images/019fb869-1a33-7a63-a488-b71159072fe7/exec-d618664c-8f15-4316-bda7-9b12964bdc2b.png`.
- Canonical project source: `public/assets/brand/folio-logo-final-source.png`.
- Browser-rendered implementation:
  - Desktop: `design-audit/folio-logo-implementation-desktop.png`.
  - Mobile: `design-audit/folio-logo-implementation-mobile.png`.
- Combined full-view comparison: `design-audit/folio-logo-full-comparison.png`.
- Combined focused comparison: `design-audit/folio-logo-focused-comparison.png`.
- Source pixels: 1254 × 1254. Canonical runtime asset: 256 × 256.
- Desktop viewport/capture: 1280 × 720 CSS px, browser-reported device pixel ratio 2, screenshot 1280 × 720 px; visible sidebar logo 44 × 44 CSS px.
- Mobile viewport/capture: 390 × 844 CSS px, device pixel ratio 1, screenshot 390 × 844 px; visible header logo 34 × 34 CSS px.
- Density normalization: the full-view comparison downsamples the selected source to 720 × 720 without changing its aspect ratio. The focused comparison normalizes the source and runtime assets to 256 × 256 and enlarges the actual 44px/34px browser crops only for small-size legibility inspection.
- State: unlocked empty-data overview, light theme, desktop and mobile responsive surfaces.

## Findings

- No actionable P0/P1/P2 mismatch remains.
- Fonts and typography: unchanged; the Logo contains no embedded text, and adjacent “Folio” typography keeps its existing family, weight, scale, and alignment.
- Spacing and layout rhythm: the selected square silhouette fits the existing 44px desktop and 34px mobile slots without stretching, clipping, or changing header/sidebar spacing.
- Colors and visual tokens: charcoal, lime, and saturated purple remain faithful to the selected source. The purple capsule stays parallel to the final green rise, with approximately one purple-stroke-width of dark edge-to-edge separation.
- Image quality and asset fidelity: the 1254px selected raster is retained as the canonical source; the 256px web image and every Tauri/macOS/iOS/Android size are generated from that same source. The thick rounded strokes, circular nodes, short purple accent, and compact arrow remain identifiable at 32px.
- Copy and content: no product copy changed as part of the asset replacement.
- Responsiveness: the Logo remains crisp and proportionally square at the desktop and mobile breakpoints, with no overflow or unexpected white rectangle around the icon slot.
- Focused-region evidence was required because the key acceptance condition is small-size recognition and the exact green/purple spacing; the combined focused comparison includes the selected source, runtime asset, 44px desktop crop, and 34px mobile crop in one image.

## Comparison History

### Iteration 1

- Compared the selected source and the live browser implementation in the same full-view and focused comparison images.
- The implementation uses the selected image directly as the master rather than recreating the mark with CSS or SVG, so no post-comparison visual correction was required.
- No actionable P0/P1/P2 difference was found.

## Primary Interactions Tested

- Opened the local workspace at the desktop breakpoint and verified both runtime Logo instances load from `/assets/brand/folio-logo.png` with a 256 × 256 natural size.
- Switched to 390 × 844 and verified the mobile header Logo at 34 × 34 without clipping.
- Navigated from overview to AI 管家 and back to overview; both navigation states remained functional after the asset/reference consolidation.
- Browser console errors after the responsive and navigation pass: none.
- `npm test`: 233/233 passed.
- `npm run build`: passed.
- `npm run test:sites`: 4/4 passed.

## Follow-up Polish

- No P3 follow-up is required for the selected Logo asset.

final result: passed

---

# Voice Stop Control QA — 2026-08-09

## Evidence

- Source visual truth: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-eb78704a-c85a-4203-b39d-5e228ad1be34.png`; the user additionally defined the missing active-state requirement: recording must have a user-controlled way to end and proceed.
- Browser implementation screenshots:
  - Recording with explicit stop control: `design-audit/voice-stop-2026-08-09/recording-with-stop.jpg`.
  - User-stopped partial transcript in review: `design-audit/voice-stop-2026-08-09/after-stop-review.jpg`.
- Combined visual comparison: `design-audit/voice-stop-2026-08-09/source-vs-stop.jpg`.
- Viewport: 1280 × 720 CSS px, device scale factor 1; implementation screenshots are 1280 × 720 px.
- Source pixels: 236 × 295 px. As with the preceding voice-card pass, the portrait reference was normalized against a centered 720 × 720 implementation crop, preserving both aspect ratios on a 1126 × 654 comparison board.
- State: active streaming recognition → explicit stop → editable partial transcript.

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: the new “结束并核对” label uses the existing Folio UI type hierarchy and remains readable without competing with the live transcript.
- Spacing and layout rhythm: the centered microphone expands in place into a 142px stop capsule, preserving the source anatomy and avoiding a second detached action row.
- Colors and tokens: the control uses the existing lime active state, charcoal icon/text, and restrained pulse shadow; no unrelated alert color was introduced.
- Image quality and asset fidelity: the control uses the existing Phosphor `Stop` icon, not a text glyph or handcrafted drawing. Waveform and card assets remain unchanged.
- Copy and content: “结束并核对” names both the immediate action and the next state. The supporting line makes the 30-second maximum secondary rather than the only exit.
- Accessibility and interaction: the stop control is a semantic enabled button with an accessible label. The review textarea appears after the active capture is stopped, and the partial transcript remains editable before analysis.

## Comparison History

### Iteration 1

- [P1] The active voice state disabled the microphone and exposed no stop command. Users could only wait for recognizer auto-finalization or the 30-second timeout, so the core capture flow was not user-controlled.
  - Earlier evidence: `design-audit/voice-card-2026-08-09/voice-card-desktop-listening.jpg`.
  - Fix: added a native `speech_stop_current` command, a 50ms stop-request check in the Apple recognizer loop, and an active-state capsule that reads “结束并核对”.
  - Post-fix evidence: `design-audit/voice-stop-2026-08-09/recording-with-stop.jpg`.

### Iteration 2

- Activated the stop control while only “今天从日常账户” had been recognized.
- Verified that capture ended and the same partial text appeared in the editable review field instead of waiting for the full preview sentence.
- Post-stop evidence: `design-audit/voice-stop-2026-08-09/after-stop-review.jpg`.
- No new P0/P1/P2 issue was introduced.

## Primary Interactions Tested

- Opened voice capture and started recognition.
- Confirmed that the centered control changes from a microphone into an enabled “结束并核对” button.
- Clicked the stop control before automatic completion.
- Confirmed the flow reached “核对本次语音稿” with the partial transcript preserved.
- Confirmed the viewport remains 1280 × 720 with no horizontal overflow (`scrollWidth = 1280`).
- Probed console and page-error events during the pointer flow; no runtime error event was observed.
- `npm test`: 229/229 passed.
- Rust backend: 105/105 passed; 2 release-environment tests ignored.

## Follow-up Polish

- [P3] A real-device timing pass should still confirm the perceived delay between pressing stop and Apple returning its final partial hypothesis; the UI already shows “正在整理” during that bounded transition.

final result: passed

---

# Voice Capture Card QA — 2026-08-09

## Evidence

- Source visual truth: `/var/folders/19/qq8ztmpj5vl67f1z6bphky680000gn/T/codex-clipboard-eb78704a-c85a-4203-b39d-5e228ad1be34.png`.
- Browser-rendered implementation:
  - Initial voice card: `design-audit/voice-card-2026-08-09/voice-card-desktop-initial.jpg`.
  - Live partial transcript and active waveform: `design-audit/voice-card-2026-08-09/voice-card-desktop-listening.jpg`.
  - Final editable transcript with visible parse action: `design-audit/voice-card-2026-08-09/voice-card-desktop-review-fixed.jpg`.
  - Codex CLI status located in Settings: `design-audit/voice-card-2026-08-09/codex-cli-settings-only.jpg`.
- Full-view combined comparison: `design-audit/voice-card-2026-08-09/source-and-folio-initial.jpg`.
- Viewport: 1280 × 720 CSS px, device scale factor 1; implementation screenshots are 1280 × 720 px.
- Source pixels: 236 × 295 px. The reference is a portrait composition rather than an app viewport, so fidelity was normalized by comparing its card anatomy against a centered 720 × 720 implementation crop. The combined board scales the source to a maximum 472 × 590 region and the implementation crop to 590 × 590 without changing either aspect ratio.
- State coverage: idle, live recognition, completed transcript review, focused transcript editor, and Settings integration status.

## Findings

- No actionable P0/P1/P2 difference remains.
- Fonts and typography: Folio retains its existing Chinese system-font hierarchy and heavier charcoal headings. The source's top transcript hierarchy is preserved without importing its small English campaign typography; live text remains readable at normal app density.
- Spacing and layout rhythm: the source anatomy is preserved as top text → middle waveform → centered lower microphone. The portrait card is centered inside the existing three-method modal rather than stretching into another full-width form surface.
- Colors and tokens: the source's neon blue was intentionally mapped to Folio charcoal, lime, lilac, and soft white. The card does not introduce a competing product palette.
- Image quality and asset fidelity: the waveform is a real-time canvas visualization driven by the native audio level, not CSS/div art or a static placeholder. The microphone is the existing Phosphor icon. No visible source imagery is replaced with an emoji, text glyph, or handcrafted SVG.
- Copy and content: connection health and version details are removed from the task modal and remain under Settings → 本机 Codex CLI. The consent checkbox is removed; pressing the microphone remains the explicit per-use authorization. The final transcript is editable before any Codex request.
- Accessibility and interaction: the microphone has an accessible label, live transcript text uses an `aria-live` region, reduced-motion mode renders a static waveform, and the transcript textarea focus state has no purple box (`box-shadow: none`, zero-width border, visible caret retained).

## Comparison History

### Iteration 1

- [P2] At 1280 × 720, the first completed-transcript state kept the full 330px recording card and pushed the primary parse action below the visible modal area.
  - Earlier evidence: `design-audit/voice-card-2026-08-09/voice-card-desktop-review.jpg`.
  - Fix: introduced a compact completed state with a 244px card, reduced waveform height, and two-line completion copy while preserving the same component anatomy.
  - Post-fix evidence: `design-audit/voice-card-2026-08-09/voice-card-desktop-review-fixed.jpg`; the parse button bounds are top 646.7px / bottom 688.7px inside the 720px viewport.

### Iteration 2

- Recompared the reference and Folio card in `source-and-folio-initial.jpg` after the compact-state fix.
- Verified live partial text, audio-reactive waveform, centered microphone, final transcript editing, and the separation of integration status from the capture flow.
- No new P0/P1/P2 finding was introduced.

## Primary Interactions Tested

- Opened the unified capture modal from the persistent lower-right Folio composer.
- Confirmed the three choices remain voice, screenshot/document, and text.
- Started the preview speech stream and observed partial text update inside the card while the waveform and microphone used the active state.
- Waited for completion, edited the generated transcript, and confirmed the parse action remains visible and enabled.
- Confirmed the task modal contains no Codex connection-status box and no device-speech consent checkbox.
- Opened Settings and confirmed the Codex CLI connection/status surface exists there.
- Checked the focused transcript editor and found no purple outline or box shadow.
- Probed console and page-error events during close/reopen interaction; no runtime error event was observed.

## Follow-up Polish

- [P3] The live canvas uses three restrained solid strokes instead of the reference's blue glow treatment; this is an intentional Folio token adaptation.
- [P3] The in-app Browser has a fixed 1280 × 720 viewport in this run. Mobile behavior is protected by the existing max-width rules and source assertions, but a separate native-device capture can be added during the mobile packaging milestone.

final result: passed

## Latest gate confirmation

- The latest completed gate is `Final Folio Logo QA — 2026-08-09` above.
- Its selected-source comparison, desktop/mobile browser captures, small-size focused evidence, navigation check, frontend tests, build, and Sites tests all passed with no remaining P0/P1/P2 finding.

final result: passed

---

## Latest gate confirmation — 2026-08-10

- The current gate is `Unframed Voice Capture QA — 2026-08-10` above.
- Implementation, source assertions, the complete frontend test suite, and the production build passed.
- The required browser-rendered screenshot, combined visual comparison, responsive check, and console inspection remain unavailable because the in-app browser rejected local URL control under its URL safety policy.

final result: blocked
