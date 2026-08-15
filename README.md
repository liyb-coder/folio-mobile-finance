# Folio — 私人财务整理助手

[English README](./README_EN.md)

Folio 是一款移动优先的私人财务整理应用，用统一视图管理账户、持仓、流水、提醒与规划。所有高风险资金动作都遵循“解析 → 核对 → 明确确认”的流程；AI 只负责整理和生成待核对草稿，不会直接改动正式账本。

![Folio 资产流水移动端界面](./implementation-assets-mobile.png)

## 本次界面更新

- 将“资产”和“流水”合并为同一个“资产流水”主入口。
- 使用更简洁的双段式 Tab 在资产与流水视图之间切换。
- 保留账户管理、产品表现、AI 调仓建议、收支趋势和追加式流水等原有能力。
- 将底部“AI 管家”入口替换为“我的”。
- 新增个人资料、本地数据、应用密码与生物识别、导入导出、QQ 邮箱和偏好设置入口。
- “AI 管家”保留为“我的助手”二级入口，中心“记一笔”快捷操作仍始终可用。

## 核心能力

- 移动优先的资产、流水、提醒和 AI 录入体验
- 本地加密账本与明确确认边界
- 账户、持仓、估值和产品操作管理
- 收入、支出、转账、导入与安全冲销
- 语音、截图/PDF、Markdown、CSV/TSV/XLSX 等资料录入
- 财务提醒、规划模拟和只读 QQ 邮箱账单连接
- React Web 演示、Tauri macOS/移动端壳和独立微信小程序代码

## 技术栈

- React 19 + Vite 6
- Tauri 2
- Recharts
- Phosphor Icons
- Node.js 原生测试
- Rust / SQLite 本地能力

## 快速开始

需要 Node.js 20+ 和 npm。

```bash
npm ci
npm run dev
```

开发服务器默认由 Vite 启动。用于查看带虚构数据的原生工作区预览：

```text
http://127.0.0.1:5173/?vault-preview=native-film
```

可通过 `screen` 参数直达本次更新的页面：

```text
?vault-preview=native-film&screen=assets
?vault-preview=native-film&screen=cashflow
?vault-preview=native-film&screen=profile
```

## 构建与测试

```bash
npm run build
npm test
node --test tests/mobile-shell.test.mjs
npm run test:privacy
```

Tauri 常用命令：

```bash
npm run tauri:dev
npm run tauri:build
npm run mobile:doctor
```

## 项目结构

```text
src/                  React 应用、领域逻辑与本地数据适配
src-tauri/            Tauri/Rust 原生能力
apps/wechat-mini/     微信小程序运行时
services/folio-bff/   本地/测试 BFF
tests/                领域、隐私、移动端与打包测试
public/assets/        品牌、图标和宠物素材
```

## 数据与安全

- 仓库只包含虚构演示数据，严禁提交真实财务资料或密钥。
- 浏览器本地模式默认锁定，不会静默回退到演示数据。
- AI、语音、文件和邮件输入只能创建待核对提案。
- 正式账本采用追加式事件；修订和撤销通过新的补偿事件完成。
- 生物识别是便捷层，应用密码始终保留为安全回退方式。

## 设计与质量

本次界面以用户提供的移动端参考图为视觉基准，在 393 × 852 视口完成资产、流水和“我的”三种状态对比。视觉验收记录见 [design-qa.md](./design-qa.md)。

## 许可证

当前仓库为私人项目，未声明开源许可证。
