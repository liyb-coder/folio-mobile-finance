# Folio 当前体验整体审计（2026-07-31）

## 审计范围

- 本地开发预览：`?vault-preview=personal-assets`
- 视口：1440×960、1280×720、390×844
- 流程：总览、流水、AI 管家、AI 录入核对
- 重点：真实/演示数据边界、桌宠与语音入口的状态关系、移动端主入口、模态层级与可访问性

## 总结

当前最严重的问题不是视觉细节，而是两个“系统边界”没有在界面上成立：

1. 个人资产预览把真实账户/持仓/事项与 `analyticsPreview` 演示趋势、演示流水装进同一个 snapshot，再由正式工作区组件混合渲染。
2. 桌宠和语音框不是同一个组件或同一个定位容器，只是两个独立的 `fixed` 浮层用坐标靠在一起；状态、页面和模态层变化后，视觉关系自然断裂。

好消息是：Tauri 原生 `vault_get_snapshot` 不返回 `analyticsPreview`，所以这次确认的是开发预览层的信任与展示问题，不是已经证明加密账本本身被 mock 数据写坏。

## 严重问题

### P0 — 个人预览是混合数据集

当前私人预览包含 7 个账户、7 个余额、16 个持仓、16 个事项、0 条真实流水，同时额外包含 6 个月演示趋势和 6 条演示流水。因为真实流水为空，流水页自动用演示流水替代；这些演示记录又引用真实账户名称。

结果：页面一边说“真实余额来自当前已解锁的本地加密账本”，另一边把演示金额放进“本月现金流”和“已确认流水”。局部小字虽写了“效果预览”，但无法抵消主标题、金额和真实账户名称带来的信任误导。

根因路径：

- `src/main.jsx` 的 DEV query 进入 `VaultPersonalAssetsPreview`。
- `vite.config.mjs` 直接读取 `.folio-private/personal-assets-preview.json`。
- `VaultPersonalAssetsPreview` 把整个对象交给 `VaultWorkspacePreview`。
- `LocalOverview` 和 `LocalCashflow` 在真实流水为空时自动切换到 `analyticsPreview`。

### P0 — “私人预览”使用正式写入文案，但实际只改浏览器内存

`VaultWorkspacePreview` 的确认动作通过 `setPreviewSnapshot` 修改内存快照；刷新即恢复。但同一套组件仍显示“写入加密账本”“已确认流水”“本地已保存”等正式语义。

这会让开发验收者无法判断：刚才确认的操作究竟写进了原生账本、写进了临时预览，还是根本没保存。

### P1 — 桌宠与语音框没有真正锚定

- 语音框：`right: 28px; bottom: 26px; height: 66px; z-index: 15`。
- 桌宠：`right: 30px; bottom: 100px; min-height: 112px; z-index: 17`。
- welcome、idle、rest 的素材高度和网格宽度继续变化。

它们没有共同父容器或共享布局约束，所以只能在某些状态“看起来接上”。在 1280×720 下，欢迎猫爪和气泡直接盖住资产配置卡；休息态缩小后又改变连接关系。

### P1 — AI 管家页主动移除语音框，却保留原坐标的桌宠

桌面端 `active === "assistant"` 时不渲染语音框，桌宠仍固定在 `bottom: 100px`，因此变成孤立浮层。移动端同样把中央“记一笔”换成空 spacer，违背了持续可达的主录入入口。

### P1 — 处理/核对状态的桌宠压在模态层之上

模态遮罩是 `z-index: 100`，桌宠的 processing/rest/ready/needs_input/done 状态被设为 `z-index: 101`。实测 ready 状态位于遮罩之上；桌宠按钮仍可操作，但它的统一行为只是打开 AI 收件箱，并不处理当前核对任务。

这同时造成视觉层级错误、模态交互歧义和可访问性风险。

### P1 — 自动测试把当前缺陷当成了“通过条件”

220 个测试全部通过，但相关测试主要是源码正则检查：素材字符串存在、CSS 类存在、页面包含“演示数据”文案即可。移动端测试甚至明确要求 `local-mobile-voice-spacer` 存在，因此无法发现 AI 管家页中央入口消失。

## 次要但系统性的问题

### P2 — 两套工作区长期分叉

`src/App.jsx` 在模块加载时硬编码 demo repository，而 `src/NativeVaultApp.jsx` 承载原生真实工作区。两套 UI 树、两套数据形状和两套交互会持续产生“这边改了、另一边没改”的漂移。

### P2 — 单文件体积已不利于状态约束

- `src/NativeVaultApp.jsx`：10,519 行
- `src/styles.css`：13,001 行
- 当前工作区相对 Git 基线有约 5,859 行新增、754 行删除

桌宠、语音、收件箱、真实仓库、预览仓库、六个模块和安全设置都在同一组件体系内交叉，状态优先级只能靠散落的条件和 z-index 维持。

### P2 — 可访问性风险

- 模态打开时，背景语音按钮和桌宠仍出现在可访问树中；尚未证明键盘焦点被限制在 dialog 内。
- 桌宠状态变化只改变按钮文案，没有 `aria-live` 状态通告。
- “演示数据”与桌宠解释文字常为 8–9px，属于关键语义却不够易读。
- 图表主要依赖视觉曲线，缺少等价的简洁文本或表格摘要。

## 已确认的优点

- 原生保险库 snapshot 只返回账户、余额、流水、事项、持仓、导入和规划，没有返回 `analyticsPreview`。
- 公共 demo 与浏览器 local/sync 的入口总体是 fail-closed；没有发现普通网页自动退回 demo 的路径。
- 演示数据已有局部标签和提示，说明产品意图是区分，只是当前区分层级不够。
- 桌宠在移动端被隐藏，避免了直接压住移动内容。
- 底层不可变账本、草稿确认和数据仓库测试覆盖较强；本轮 220 个测试全部通过。

## 推荐修复顺序

1. 建立强类型的数据来源边界：`real | fictional_demo | display_preview`，禁止一个工作区 snapshot 同时承载 real 与 display preview；真实数据为空时展示空态，不自动拿演示流水替代。
2. 为私人开发预览增加永久顶部标识“本机预览 · 内存操作 · 不写入保险库”，并把所有“已确认/正式写入”文案换成“预览确认/仅本页生效”。
3. 把语音框与桌宠重构成一个 `DesktopCaptureDock`：一个 fixed 容器、一个相对坐标系、明确的 attached / overlay / hidden 模式。
4. 模态打开时，桌宠不得位于遮罩之上；需要状态反馈时，把宠物状态放进模态内部，或只用 `aria-live` 通知。
5. 移动端永远保留中央“记一笔”，AI 管家页不再放空 spacer。
6. 增加真实渲染测试：1280×720、1440×960、390×844；覆盖 welcome/idle/rest/processing/ready/needs_input/done，以及 overview/assistant/modal 三类宿主状态。
7. 拆分 `NativeVaultApp.jsx` 和 `styles.css`，先分出 data-origin、capture dock、pet state machine、preview runtime 四个独立边界。

## 审计步骤与健康度

1. 桌面总览 idle：较差 — 真/演示金额同屏，桌宠靠坐标贴近语音框。
2. 桌面 AI 管家：较差 — 语音框消失后桌宠孤立悬浮。
3. 桌面总览 rest：较差 — 状态尺寸变化并遮挡资产配置。
4. 桌面流水：严重 — 演示记录使用真实账户语境并出现在“已确认流水”。
5. 移动总览：一般 — 主流程可用，但演示金额仍进入首屏核心指标。
6. 移动 AI 管家：较差 — 中央主录入入口消失，留下空槽。
7. AI 核对模态：严重 — ready 桌宠位于模态遮罩之上。
8. 1280×720 常用桌面：严重 — 欢迎猫爪/气泡/语音框组合覆盖核心资产配置内容。

## 截图

1. `01-desktop-overview-idle.png`
2. `02-desktop-assistant-floating-pet.png`
3. `03-desktop-overview-rest.png`
4. `04-desktop-cashflow-mixed-preview.png`
5. `05-mobile-overview.png`
6. `06-mobile-assistant-missing-center-capture.png`
7. `07-desktop-review-pet-over-modal.png`
8. `08-desktop-1280-overlap.png`

## 证据限制

- 本轮没有输入真实密码，也没有打开或修改 Tauri 正式保险库。
- 数据混合结论针对当前 `personal-assets` 开发预览；原生保险库未发现同样的 `analyticsPreview` 输出路径。
- 可访问性结论来自 DOM、ARIA 与可见状态检查；未完成 VoiceOver 全流程或完整 WCAG 合规测试。
