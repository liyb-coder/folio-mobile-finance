# Folio macOS MVP 发布检查表

更新：2026-07-27  
目标：用户本人 Apple Silicon Mac 上可安全、稳定地使用真实数据。

## 已满足

- [x] Apple Silicon Tauri 2 应用和 DMG 构建链。
- [x] SQLCipher 整库加密、随机 DEK、Argon2id 应用密码封装。
- [x] 应用密码锁定、自动锁定、Touch ID 原生实现和密码回退。
- [x] 不可变账本、账户、持仓、流水、事项、规划和本机隐私通知。
- [x] 手工录入、CSV/TSV/XLSX、显式表格粘贴和设备内图片/PDF 识别。
- [x] 语音/文件/AI 的解析 → 核对 → 明确确认边界。
- [x] 加密备份/恢复和需重新认证的明文可移植导出。
- [x] 仓库隐私扫描、JavaScript、Sites、Rust/SQLCipher 自动化回归。
- [x] DMG 只读挂载烟测：应用结构、Applications 入口、arm64、Bundle ID/版本、最低系统、签名/权限、动态库路径及私有文件排除均通过。
- [x] 最终 `Folio.app` 已复制到 `/Applications`；Bundle ID `com.beizi.folio`、版本 `0.1.0`、arm64、签名及来源可执行文件 SHA-256 全部匹配，并已成功启动原生进程。
- [x] 解锁后的瞬时原生窗口失焦使用绑定当前会话的 2 秒可取消缓冲；持续失焦仍自动锁定，并覆盖瞬时恢复、持续后台、旧会话回调及多来源后台事件测试。

## P0 · 功能 MVP 阻点

- [ ] 在用户 Mac 登记 Touch ID，成功解锁后手动锁定，再验证应用密码回退。
- [ ] 退出并重启 Folio，确认只显示锁定面且可重新打开同一保险库。
- [ ] 用代表性真实数据副本完成账户/持仓手工建档和流水 CSV/XLSX 导入。
- [ ] 对照原始数据核对期初余额、导入净变化、账户余额和关键持仓市值。
- [ ] 重复导入同一文件，确认余额和流水数不重复增加。
- [ ] 导出加密备份，恢复为新保险库；核对账户、持仓、流水和事项数量。
- [ ] 导出可移植 ZIP/CSV，确认第三方表格工具可读；随后安全删除测试明文副本。
- [ ] 用最新 DMG 做一次干净安装和一次覆盖升级，确认既有保险库不丢失。
- [ ] 强制退出应用后重开，验证 SQLCipher 完整性和最后一次已确认写入。

## P1 · 对外分发阻点

- [ ] 安装完整 Xcode，而非仅 Command Line Tools。
- [ ] 配置有效 Apple Developer ID Application 身份；当前检查结果为 `0 valid identities found`。
- [ ] 对 `.app` 和 DMG 完成 hardened runtime 签名、公证、stapling 和 Gatekeeper 验证。
- [ ] 若支持 Intel Mac，增加 x86_64 或 universal 构建并完整回归。

P1 不阻塞用户本人在当前 Apple Silicon Mac 上试用 ad-hoc 开发包，但会影响其他用户直接双击安装时的信任体验。

自动验证命令：`npm run macos:verify:dmg`。正式分发门使用 `FOLIO_REQUIRE_NOTARIZED=1 npm run macos:verify:dmg`；当前 ad-hoc 包会按预期失败，不会被误认为已公证。

## 体检与证据记录

- 运行 `npm run macos:mvp:doctor` 查看三组门的可读结论。
- 需要结构化结果时运行 `npm run --silent macos:mvp:doctor -- --json`。
- 首次手工验收前，把 `.folio-mvp-acceptance.example.json` 复制为 `.folio-mvp-acceptance.json`；每完成一项才把对应值改为 `true`。
- 本地完成记录已被 Git 忽略，只保存布尔结果，不要在其中写入真实文件路径、账户、金额、密码或备注。
- 全部本人自用项目完成后运行 `npm run macos:mvp:doctor -- --strict-self-use`，退出码 0 才能把 Mac MVP 标记为已验收。

## 明确延期

- iOS/Android、应用商店、移动端后台同步。
- 私人 Web、生产 Supabase、跨设备同步和设备撤销。
- 外部 AI/转写、本地大模型、飞书 API 和银行直连。
