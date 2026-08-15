# Folio Mobile Design QA

## Evidence

- Source visual truth: `design-audit/reference-unified-finance-profile.png`
- Source pixels: 1495 × 1052, containing three adjacent mobile states (assets, cashflow, profile)
- Implementation screenshots:
  - `implementation-assets-mobile.png`
  - `implementation-cashflow-mobile.png`
  - `implementation-profile-mobile.png`
- Full-view comparison: `design-qa-v3-comparison.png`
- Comparison source: `design-qa-v3-comparison.html`
- Implementation viewport: 393 × 852 CSS px
- Implementation pixels: 393 × 852 at deviceScaleFactor 1
- Density normalization: the source board is scaled to 852 px high inside three 393 × 852 clipped frames; implementation captures are native 393 × 852 DPR 1 images.
- States: assets tab selected, cashflow tab selected, and profile selected.
- Browser-rendered evidence: Vite preview rendered in headless Chrome through the DevTools protocol with explicit mobile device metrics.

## Findings

No actionable P0, P1, or P2 differences remain.

### Required fidelity surfaces

- Fonts and typography: implementation uses the existing Folio system stack (`-apple-system`, BlinkMacSystemFont, PingFang SC fallbacks), with hierarchy and optical weights closely matching the source. Labels remain readable at the target viewport without unintended wrapping.
- Spacing and layout rhythm: header, centered segmented control, summary cards, profile hero, list rows, and fixed bottom navigation follow the source composition. Card radii, section gaps, and bottom-safe-area spacing are consistent.
- Colors and visual tokens: low-saturation grey/lilac surfaces, charcoal active controls, lime confirmation accents, purple capture outline, and muted secondary copy all match the supplied direction.
- Image quality and asset fidelity: the approved Folio logo and canonical charcoal-grey cat avatar are used directly from `public/assets/brand/`. UI symbols use Phosphor Icons; no emoji, CSS drawings, placeholder art, or handcrafted SVG substitutions were introduced.
- Copy and content: “资产流水”, “资产”, “流水”, “我的”, “应用密码与生物识别”, “本地数据”, “导入与导出”, “QQ 邮箱”, “偏好设置”, and “我的助手 · 仅整理，确认后写入” match the requested information architecture.

### Intentional differences

- Amounts, account counts, account rows, and chart paths come from the project’s existing confirmed fictional fixture rather than the static values in the visual reference. This preserves real app behavior and does not change the requested layout.
- The implementation exposes compact helper text under profile actions. This is an intentional usability enhancement and remains visually subordinate to the source labels.

## Interaction and runtime checks

- Switched from Assets to Cashflow: the Cashflow tab reported `aria-selected="true"`; “收支变化” and “全部流水” rendered.
- Switched back to Assets: the Assets tab reported `aria-selected="true"`; “资产配置” and “添加账户” rendered.
- Opened the “我的” destination from the persistent bottom navigation.
- Opened “我的助手” from the profile menu and confirmed the assistant workspace rendered.
- Opened the persistent centered “记一笔” action and confirmed the capture dialog rendered.
- Browser console/runtime errors: none.
- Production build: passed.
- Mobile shell tests: 12/12 passed.

## Comparison history

### Iteration 1

- [P2] Mobile segmented control was wider and lower than the source.
- [P2] Profile hero sat too high; the avatar and horizontal inset were larger than the source.
- [P2] The asset summary’s add-account action collapsed to an icon-only button.

Fixes made:

- Centered the segmented control at the source-like width and lifted the shared finance hub into the reference rhythm.
- Adjusted profile hero top offset, height, avatar size, inset, and gap.
- Restored the visible “添加账户” label with a compact dark action button.

Post-fix visual evidence: `design-qa-v3-comparison.png`. The revised captures remove all three P2 mismatches.

## Focused-region review

A separate focused crop was not required. The normalized 393 × 852 panels in `design-qa-v3-comparison.png` keep the tab labels, profile rows, card spacing, icons, amounts, and bottom-navigation states legible at original mobile density.

## Follow-up polish

- [P3] The Cashflow chart is intentionally taller than the reference because the confirmed fixture uses six visible points and larger axis labels. It can be shortened in a later purely visual pass if more first-screen ledger rows are preferred.

## Implementation checklist

- [x] Assets and cashflow share one destination and working two-way tabs.
- [x] Bottom navigation uses “我的” instead of “AI 管家”.
- [x] Assistant remains reachable from “我的助手”.
- [x] Center capture action remains persistent.
- [x] Source and implementation compared at the same mobile viewport.
- [x] P0/P1/P2 findings fixed and re-captured.

final result: passed
