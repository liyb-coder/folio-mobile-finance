# Folio iOS 开发状态

> 更新：2026-08-11  
> 阶段：原生工程、iOS 工具链和签名已就绪，等待真机冒烟测试

## 已完成

- Tauri 2 iOS 工程已生成：`src-tauri/gen/apple/folio.xcodeproj`。
- Bundle ID 为 `com.beizi.folio`，最低系统版本为 iOS 14。
- 已声明麦克风、设备端语音识别、Face ID 三项用途说明。
- Apple 语音识别仅输出实时文字和归一化音量，不保存原始音频。
- 已有 iPhone 端 OpenAI/Keychain 备用实验代码，但当前 DeepSeek 测试路线不使用它，也不会把 DeepSeek 密钥写入手机。
- iPhone 端后续只把已核对文字交给开发/预发 Folio BFF；DeepSeek 凭证仅存在服务端环境或密钥服务。
- macOS 继续使用本机已登录的 Codex CLI，不改变客户演示路径。
- `aarch64-apple-ios-sim` 原生静态库已完成完整编译，包括 Swift bridge、SQLCipher、Keychain、设备端语音和本地文档提取。

## 验证结果

- 前端/领域测试：248 通过，0 失败。
- Rust 原生测试：105 通过，0 失败，2 个外部环境测试按设计忽略。
- iOS plist 与 entitlement：全部通过 `plutil -lint`。
- Xcode 工程：scheme `folio_iOS` 可被 `xcodebuild` 正常读取。

## 当前环境阻塞

- Xcode 26.6、iPhoneOS/iPhoneSimulator 26.5 SDK 和 CocoaPods 1.15.2 已就绪。
- 已检测到 1 个有效 Apple Development 签名身份。
- 当前没有检测到已连接并信任的 iPhone，这是 iOS 冒烟测试的唯一硬件阻塞。
- Android 仍缺 JDK/JBR、Android SDK、SDK Manager 和 adb，不应将 iOS 就绪误报为双平台就绪。
- 2026-08-11 当前 Codex 终端进程未读取到 `DEEPSEEK_API_KEY`；`npm run deepseek:doctor` 因凭证不可见而在发起网络请求前失败。
- DeepSeek BFF 模拟上游、原文证据校验和桌面 BFF 客户端已通过 5 项测试；真实模型请求尚未证明。

## 下一次继续步骤

1. USB 连接 iPhone、解锁并点按“信任”，开启开发者模式。
2. 打开 `src-tauri/gen/apple/folio.xcodeproj`，确认 Signing & Capabilities 选择当前 Team。
3. 启动只在 Mac/预发服务端持有 DeepSeek 凭证的测试 BFF，手机仅配置非机密 HTTPS 基址。
4. 执行 `npm run tauri:ios:dev`，完成密码、Face ID、语音、文档、DeepSeek 待核对提案和逐项确认的真机冒烟测试。

未完成第 5 步前，不将当前产物描述为“已完成真机安装”或“可上架版本”。
