# ADR-006：MVP 选择原生微信薄壳

状态：Accepted for MVP  
日期：2026-08-11

## 问题

Folio 桌面端使用 React 19.2、Vite 和 Tauri，同时依赖 DOM、SVG/Recharts、桌面文件系统与 Rust command。微信端要保留日常采集→核对→确认的价值，不能为了表面上的组件复用引入不可审计的依赖或降级桌面端。

## Spike 证据

2026-08-11 使用 Taro CLI 4.2.1 官方内置默认模板进行 React/TypeScript/Webpack5 小程序实验：

| 项目 | 结果 |
|---|---:|
| `@tarojs/react` peer React | `^18` |
| 桌面端 React | `19.2.0` |
| 安装依赖数 | 1509 packages |
| 空白 weapp 构建 | 成功，5.49s |
| 空白 `dist` | 332KB |
| `npm audit --omit=dev` | 24 个：7 critical、1 high、16 moderate |
| 主要未修复生产链路 | `swiper`、`lodash-es` 等间接依赖 |

这些数字是当时环境的可重复证据，不是对 Taro 长期的否定。但它们不符合 Folio MVP 的依赖安全和简洁门禁。

## 决策

- 小程序 MVP 使用原生 WXML/JS 薄壳，当前无 npm 运行依赖；
- 共享 `folio-contracts`、后端 API 语义、设计 token 和 fixture，不共享 DOM 组件；
- 趋势与声波图使用微信 Canvas 2D，图标使用审核过的本地资源；
- 微信平台 API 必须经过 adapter，页面不直接组装账本写入；
- 桌面端保持 React 19.2，不为小程序降级。

## 再评估条件

Taro 或其他跨端方案要同时满足：

1. 支持桌面端当前 React 主版本，不依赖非官方兼容补丁；
2. 生产依赖无未处置 high/critical，且 SBOM 可审计；
3. 真实 iPhone/中低端 Android 的首屏、Canvas、录音和长列表优于或等于原生壳；
4. 主包预留至少 30% 平台限制余量。

## 当前未完成证据

原生 Canvas 页面已通过源码和包体自动化检查，但当前 Mac 未安装微信开发者工具，尚未完成开发者工具和真机 Canvas 验收。该证据在 M1 退出前必须由人工补齐。

