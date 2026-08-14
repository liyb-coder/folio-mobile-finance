# Folio Android 独立开发底包

创建日期：2026-08-14

## 这份底包是什么

这是从 Folio 当前开发工作区按磁盘现状复制出的独立源代码快照，供后续 Android 版本开发使用。它不是 APK，也不代表 Android 原生工程已经完成。

当前产品并非“macOS、iOS 各自一套完全独立业务代码”。主要结构是：

- `src/`：macOS、iOS 和未来 Android 共用的 React 界面与业务交互。
- `src-tauri/src/`：共用的 Tauri/Rust 原生能力与本地账本逻辑。
- `src-tauri/gen/apple/`：已经生成的 iOS Xcode 工程，保留作现状参考；构建产物已排除。
- `public/`：品牌、桌面宠物和界面资源。
- `services/folio-bff/`：移动端语义模型调用所需的开发/预发 BFF；密钥只能在服务端环境中配置。
- `packages/folio-contracts/`：跨端共享的数据契约。

基线来自原工作区分支 `codex/mobile-mvp-core`，源提交为 `94ad487`。原工作区当时有大量尚未提交但已经开发完成或正在使用的改动；本底包按当前磁盘内容完整取样，并在新的 Git 仓库中固化为独立基线。

## 已有移动端能力

- 移动优先响应式界面和固定底部 AI 采集入口。
- 应用密码解锁、本地加密数据、账本与资产/持仓/提醒/规划模型。
- 语音、文字、截图/PDF、Markdown、CSV/TSV/XLSX 等输入的审核流程。
- 高风险财务动作的“解析 → 核对 → 明确确认”边界。
- DeepSeek 开发/预发 BFF 客户端和原文证据校验；模型密钥不会编译进移动端。
- iOS 工程、Apple 端语音/文档/Keychain/Face ID 相关实现与测试。
- Android 图标资源、移动入口和 Tauri Android 初始化脚本。

## Android 尚未完成的部分

- 尚未生成 `src-tauri/gen/android/` 原生工程。
- 当前制作底包的 Mac 尚未配置完整 JDK/JBR、Android SDK、SDK Manager、adb 和 NDK。
- Apple 专用的语音识别、Keychain、通知和 PDF/Vision 提取在 Android 上需要对应实现；现有 Rust 代码对部分非 Apple 平台会安全失败，不能视为功能已完成。
- 尚未进行 Android 模拟器或真机冒烟测试，也没有可安装 APK/AAB。

## 隔离约定

这份目录是独立 Git 仓库。后续 Android 开发只在本目录或从本目录创建的新仓库中进行，不要把 Android 原生工程直接生成到原 iOS/macOS 工作区。需要把通用修复带回旧工程时，应单独审查并选择性回迁。

原有 Tauri identifier `com.beizi.folio` 暂时保留，以确保此包是忠实快照。开始 Android 正式开发时，应先确定 Android application ID 和签名策略，再生成原生工程；不要在没有确认的情况下复用生产签名材料。

## 首次开发步骤

1. 安装 Android Studio，并通过 SDK Manager 安装 Android SDK Platform、Platform Tools、Build Tools、Command-line Tools 和 NDK。
2. 配置 `JAVA_HOME`、`ANDROID_HOME`/`ANDROID_SDK_ROOT`，确认 `javac`、`sdkmanager` 和 `adb` 可用。
3. 在本目录执行 `npm ci`。
4. 执行 `npm run mobile:doctor -- --strict`，补齐所有 Android 和 Rust target。
5. 确定 application ID 后执行 `npm run tauri:android:init`。
6. 先补 Android 的安全存储、语音、文档提取和通知适配及回归测试，再做模拟器与真机验证。

## 本底包主动排除的内容

- 原 Git 历史和原工作区身份。
- `node_modules/`、`dist/`、`src-tauri/target/`、iOS archive/静态库等可再生成产物。
- `.env`、签名证书、keystore、provisioning profile 和其他密钥材料。
- `.folio-private/`、个人资产快照、本地数据库、备份、私密导出和验收机本地配置。
- 与 Android 开发无关的产品宣传视频工程。

这些排除项不会影响从源码安装依赖、运行测试或继续 Android 开发。
