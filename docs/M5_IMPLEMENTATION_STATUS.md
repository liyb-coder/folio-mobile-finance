# M5 iOS 与 Android 实施状态

更新：2026-07-27

## 已落地

- Rust 共享 crate 已声明 `tauri::mobile_entry_point`，领域、SQLCipher、草稿、同步和 AI 证据代码继续使用同一实现。
- 共享同步协议已覆盖账户、持仓资料、估值、账本、产品操作、补偿更正和事项；移动端接入同一云保险库后可复用依赖排序、认证解密、幂等与冲突隔离实现，仍待真机网络和后台生命周期验收。
- `package.json` 提供可重复命令：
  - `npm run mobile:doctor`
  - `npm run tauri:ios:init`
  - `npm run tauri:android:init`
- 移动就绪检查会检测完整 Xcode、iPhoneOS/iPhoneSimulator SDK、CocoaPods、JDK、完整 Android SDK/NDK 组件、SDK Manager、ADB，以及 3 个 iOS 和 4 个 Android Rust targets；`--json` 可输出结构化证据，`--strict` 可用于 CI 发布门。
- 当前机器已安装全部 7 个 Tauri 官方移动 Rust targets。
- 原生保险库共享界面增加：
  - 固定五栏底部导航。
  - 中央单手可达语音/文字录入按钮。
  - AI 管家页面用中央占位避免重复语音入口。
  - 顶部“全部模块”抽屉，保证流水、规划和设置等非底栏模块仍可访问。
  - `safe-area-inset-bottom` 适配刘海屏/手势区域。
  - 手机宽度下隐藏桌面右下角语音浮层，避免重复入口。
- Apple 共用原生层已实现 PDFKit/Vision 图片与扫描 PDF 设备内识别，并在构建脚本中区分 AppKit/UIKit；当前只在 macOS 完成真实编译与 Vision 集成测试，iOS 仍需完整 SDK 后验证。
- Apple 共用原生层已接入 UserNotifications；通用锁屏文案、标题显式选择、稳定排程标识和权限撤销失败关闭在 macOS 编译与单元测试通过，iOS 仍需完整 SDK/真机验证。
- Apple 共用原生层已接入 AVAudioEngine + Speech，强制设备内识别且不保存原始音频；macOS 已编译、打包并核验用途说明与 entitlement，iOS 仍需完整 SDK/真机验证。

## 当前环境审计

本机当前可继续 macOS 开发，但不能可靠初始化或编译移动原生工程：

- 只有 Xcode Command Line Tools，没有完整 Xcode。
- 没有 iPhoneOS / iPhoneSimulator SDK。
- 没有 Java/JDK。
- 没有 Android SDK Manager 和 ADB。
- 7 个 iOS/Android Rust targets 已安装；iOS 交叉检查推进至 `iphoneos` SDK 缺失，Android 交叉检查推进至 NDK `aarch64-linux-android-clang` 缺失。
- 当前数据盘仅约 14 GiB 可用，不能在不清理空间的前提下安全安装完整 Xcode 与 Android Studio/SDK。

因此本阶段没有运行 `tauri ios init` 或 `tauri android init`，避免提交无法复现、无法编译的生成目录。

## 已验证

- 移动壳静态约束测试覆盖底部五栏、中央语音位、安全区、全模块抽屉和 Tauri mobile entrypoint。
- 共享 React/Vite 生产构建通过。
- `npm run mobile:doctor` 能给出逐项失败原因和安装方向，不影响 macOS 构建。

## 尚未完成

1. 安装完整 Xcode，接受许可，安装 iOS platform 和模拟器。
2. 安装 JDK、Android Studio、SDK、Platform Tools 和 Build Tools。
3. 运行 Tauri iOS/Android 初始化，审查生成工程与权限声明。
4. 为 iOS 验收 Face ID/Touch ID Keychain 访问控制；Android 实现 BiometricPrompt + Keystore。
5. 验证 SQLCipher 在 iOS/Android 的交叉编译、加密静态检查、迁移和备份恢复。
6. 真机完成启动锁、后台锁、中央语音、草稿确认、离线队列和同步测试。
   - 同时验证系统通知授权、锁屏隐私、后台投递、时区变化和通知点击后的解锁门。
7. 建立平台 CI、签名密钥隔离、TestFlight/Android 内测发布流程。

在原生工具链和真机证据完成前，M5 只宣称“共享界面与工程就绪检查完成”，不宣称已有可安装的 iOS/Android 包。
