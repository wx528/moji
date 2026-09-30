# 更新日志 Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.3] - 2026-10-01

### Added

- **卡片笔记 / 剧情大纲真实数据化**：此前为静态占位内容，现每本书拥有独立卡片（`note_cards` 表，按 `book_id` 隔离）
- 卡片内容可直接编辑（`contentEditable`，失焦自动保存）
- 卡片标题双击重命名；每个 Tab 支持新增卡片
- 旧书籍访问时自动惰性生成默认卡片（主要角色 / 剧情备忘 / 主线大纲 / 本章要点）
- 新增 API：`POST /api/cards`、`PATCH /api/cards/[id]`，均校验书籍归属

## [0.1.2] - 2026-10-01

### Added

- **书籍删除**：书架卡片悬停显示删除按钮，确认后软删除（`books.deleted` 列，章节内容保留在数据库中）
- 已删除书籍从书架列表隐藏，且无法再通过 URL 直接打开
- `lib/db.js` 启动时自动执行轻量列迁移（`ALTER TABLE ... ADD COLUMN`，幂等）

### Fixed

- 书架页数据请求失败（如 dev 热编译窗口期）时页面永久卡在“加载中”的问题，现在会降级为空列表

## [0.1.1] - 2026-10-01

### Added

- `npm run seed` 初始化脚本：创建演示账号（`demo@moji.app`）与示例书籍《星河漫游指南》，幂等可重复执行
- Seed 支持 `--reset` 参数（清空 `.data` 后重新初始化）及 `SEED_EMAIL` / `SEED_PASSWORD` / `SEED_NAME` 环境变量覆盖
- `lib/db.js` 打开数据库前自动创建 `.data` 目录，全新环境下 seed 可直接运行

### Changed

- `package.json` 声明 `"type": "module"`，lib 内部模块导入补全 `.js` 扩展名（兼容 Node 原生 ESM）
- README 快速开始补充 Seed 用法

## [0.1.0] - 2026-10-01

### Added

- **账号体系**：注册 / 登录（前后端双重校验）、scrypt 密码哈希、HMAC 签名 httpOnly Cookie、“记住我”、"middleware" 路由守卫
- **登录页 / 注册页**：按 Figma 设计稿还原，左右分栏布局
- **书架页**：多本书管理（新建 / 切换）、仿真书封面（书脊、装帧双线框、书名首字印章、竖排书名，6 套配色按 ID 稳定分配）
- **写作统计**：今日新增 / 累计新增 / 近 14 天动笔天数 + 纯 CSS 柱状图
- **编辑器**：
  - `contentEditable` 稿件编辑，防抖 0.8s 自动保存入库
  - 章节新建 / 双击重命名 / 拖拽排序（章节与小节独立排序）/ 软删除
  - 小节折叠 / 展开（localStorage 记忆）
  - 回收站（恢复 / 彻底删除）
  - 实时字数：本章 / 全书 / 今日新增
  - Markdown 导出（本章 / 全书）
- **暗色模式**：CSS 变量切换，localStorage 持久化，防首屏闪烁
- **数据层**：better-sqlite3（WAL），books / chapters / writing_stats 三表，数据按用户隔离
- **响应式**：平板隐藏右侧面板、移动端隐藏左侧目录

### Fixed

- 顶栏用户下拉菜单脱离定位锚点、跑到视口右下角的问题
- 目录折叠箭头方向错误（展开时朝左）
- 折叠箭头被通用 `span` 选择器的 `flex: 1` 误伤，导致章节标题错位、看起来像上一章的子项
- 编辑器同路由客户端导航（书架 → `/editor?bookId=`）不重新加载数据的问题
