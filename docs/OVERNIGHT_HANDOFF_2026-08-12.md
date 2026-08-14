# Folio 夜间开发交接

日期：2026-08-12

## 已完成

### STEPX Neo 提案

- 读取活动完整提案，确认其核心不是聊天，而是“持续理解目标、自主规划、调用系统/应用能力并真正完成任务”；
- 产出活动定制方案：`docs/STEPX_SUBMISSION_PLAN.md`；
- 新增协议中立 Agent 工具适配器：`packages/folio-agent-tools`；
- 工具覆盖提案、提醒、规划快照、核对导航、前台确认和闲钱模拟；
- 高风险确认强制前台、5 分钟内重新验证、逐项选择、版本检查和幂等键；
- 对抗测试 6/6 通过：`npm run test:agent`。

### 微信小程序

- 安装微信开发者工具 2.02.2607271 Apple Silicon RC，验证 Tencent Developer ID 签名和 Gatekeeper；
- 开启工具 CLI 服务端口，`cli islogin` 可用；当前为未登录状态；
- 尝试导入工程，明确阻塞为真实 AppID：新版工具拒绝 `touristappid`，返回 code 10；
- 完成 M2a 文字输入 → 无密钥 BFF → DeepSeek 语义整理 → 证据校验 → 待核对卡；
- 客户端拒绝伪造 confirmed、服务器写入状态、缺失证据、幻觉引用和非 HTTPS 远端；
- 没有真实身份和防重放服务前，确认写账按钮保持不可用；
- 新增 M2a 测试章程和对抗审查报告；
- 微信测试 19/19 通过。

### 产品宣传片

- 新建 LibTV 项目：`Folio 产品宣传片 V7｜STEPX 60秒完整片`；
- 画布：https://www.liblib.tv/canvas?projectId=a42dbf1e6ecd4d309f1057648c99d3b2
- 只新增两次生成，控制积分：Seedance 2.5 开场 15 秒，MiniMax H3 收尾 15 秒；
- 中间复用 V6 成功的 Seedance 30 秒主体；
- 完成 60.168 秒普通话旁白 + 统一背景音乐成片；
- 本地成片：`promo-video/ai-film-v7/output/folio-v7-60s-vo-bgm.mp4`；
- LibTV 成片节点：`V7成片｜60秒｜普通话旁白+统一配乐`；
- 抽取 8 个时间点质检：无倒置、镜像、比例错误和独立营销文字乱码；生成 UI 小字仍存在轻微重绘，正式公开版应使用真实录屏覆盖需要逐字阅读的片段。

### 工程健康

- `npm test`：270/270 通过；
- `npm run build`：通过；
- `npm run test:sites`：4/4 通过；
- `npm run demo:doctor`：READY；
- 演示检查现在能识别已安装在 `/Applications/Folio.app` 的独立应用，不再因为清理构建缓存误报“未构建”；
- 微信开发者工具临时安装包和展开目录已删除，约 2.5 GB 临时空间可回收；
- `DEEPSEEK_API_KEY` 对本任务进程仍不可见，因此没有伪造“真实联网通过”。

## 你回来后最少要做的四件事

1. 提供/确认微信小程序真实 AppID，并在微信开发者工具扫码登录；
2. 把开发者和体验成员加入小程序后台，配置一台真实测试手机；
3. 让启动 BFF 的服务端进程能读取 `DEEPSEEK_API_KEY`，再运行 `npm run deepseek:doctor`；
4. 向 STEPX 主办方索取 Step AOS Skill/工具声明格式、深链、前台确认标记和真机调试说明。

## 下一里程碑顺序

1. 小程序 M2b：微信身份绑定、提案版本、前台重新验证、防重放、逐项确认；
2. 微信开发者工具真实 AppID 编译和同视口视觉修正；
3. Step AOS 适配壳和真机 smoke test；
4. 小程序语音 ASR，再做截图/PDF OCR；
5. 宣传片公开版用真实录屏替换 2–3 个需要读字的生成片段，并加入真实 Logo/Slogan 尾卡。

## 明确未完成

- 小程序真实 AppID 编译、扫码登录、真机、体验版和审核；
- DeepSeek 真实联网测试；
- Step AOS 未公开 SDK/Skill 格式的最终接入；
- iOS 真机链路；
- 正式公开宣传片的真实 UI 覆盖和最终品牌尾卡。
