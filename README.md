# FlowBatchPilot

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Chrome](https://img.shields.io/badge/Chrome-88+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-orange.svg)

**为 Google Labs Flow 提供批量视频生成的自动化工具**

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [使用指南](#-使用指南) • [技术文档](#-技术文档) • [故障排除](#-故障排除)

</div>

---

## 📋 目录

- [项目简介](#-项目简介)
- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [技术架构](#-技术架构)
- [配置说明](#-配置说明)
- [故障排除](#-故障排除)
- [开发指南](#-开发指南)
- [更新日志](#-更新日志)
- [许可证](#-许可证)

---

## 🎯 项目简介

**FlowBatchPilot** 是一款专业的 Chrome 浏览器扩展，专为 Google Labs Flow 平台设计，提供全自动化的批量视频生成解决方案。通过智能化的任务队列管理、自动模式切换和文件处理，帮助用户高效完成大批量视频生成任务。

### 核心价值

- ⚡ **高效自动化** - 一键启动，全自动处理整个工作流程
- 🎯 **精准控制** - 智能队列管理，支持暂停、恢复、清空操作
- 🔄 **自动恢复** - 页面刷新后自动恢复未完成任务
- 📊 **实时监控** - 详细的进度追踪和状态反馈
- 🛡️ **稳定可靠** - 完善的错误处理和重试机制

---

## ✨ 功能特性

### 核心功能

#### 🚀 批量处理
- 支持多图片、多提示词的批量自动化处理
- 智能任务队列管理（最多5个并发任务）
- 自动任务调度和资源管理

#### 🎨 智能模式识别
- 自动识别并切换生成模式：
  - **帧转视频** (Frames to Video)
  - **素材转视频** (Ingredients to Video)
  - **文本转视频** (Text to Video)
- 支持中英文模式名称识别
- 智能模式验证和错误恢复

#### ✂️ 多种裁剪模式
- **竖版 (9:16)** - 适合手机屏幕、短视频平台
- **横版 (16:9)** - 适合电脑屏幕、常规视频
- 自动裁剪比例设置和验证

#### 📥 自动下载管理
- 生成完成后自动下载视频
- 智能文件命名：`序号_提示词片段_时间戳.mp4`
- 支持批量下载管理

#### 🔄 自动恢复机制
- 页面刷新后自动检测未完成任务
- 智能状态同步和恢复
- 支持跨会话任务继续

### 高级特性

#### 📊 实时监控
- 任务进度实时显示
- 成功/失败计数统计
- 详细的日志记录系统

#### 🛡️ 错误处理
- 完善的错误捕获和恢复机制
- 自动重试关键操作
- 详细的错误日志记录

#### ⚡ 性能优化
- 原子状态更新，防止竞态条件
- 智能文件缓存机制
- 优化的DOM操作和事件处理

---

## 🚀 快速开始

### 系统要求

- **浏览器**: Chrome 88 或更高版本
- **操作系统**: Windows / macOS / Linux
- **网络**: 需要访问 Google Labs Flow 平台

### 安装步骤

1. **下载项目**
   ```bash
   # 克隆或下载项目到本地
   git clone <repository-url>
   # 或直接下载 ZIP 文件并解压
   ```

2. **打开 Chrome 扩展管理页面**
   - 在地址栏输入：`chrome://extensions/`
   - 或通过菜单：`更多工具` → `扩展程序`

3. **启用开发者模式**
   - 点击页面右上角的 `开发者模式` 开关

4. **加载扩展**
   - 点击 `加载已解压的扩展程序`
   - 选择项目文件夹（包含 `manifest.json` 的目录）

5. **验证安装**
   - 扩展图标应出现在浏览器工具栏
   - 访问 [Google Labs Flow](https://labs.google/fx/tools/flow) 页面
   - 点击扩展图标，确认控制面板正常显示

### 首次使用

1. 访问 Google Labs Flow 页面
2. 点击浏览器工具栏中的 FlowBatchPilot 图标
3. 按照 [使用指南](#-使用指南) 配置任务
4. 点击 `开始队列` 按钮启动自动化处理

---

## 📖 使用指南

### 基本工作流程

```
准备素材 → 配置参数 → 启动队列 → 监控进度 → 获取结果
```

### 详细步骤

#### 1. 准备素材

**提示词准备**
- **方式一：手动输入**
  - 在提示词输入框中，每行输入一个提示词
  - 支持多行输入，自动按行分割

- **方式二：CSV 文件导入**
  - 创建 CSV 文件，包含提示词列
  - 支持的 CSV 格式：
    ```csv
    # 单列格式
    美丽的日落风景
    繁华的城市夜景
    宁静的森林小径
    
    # 带标题格式
    prompt
    美丽的日落风景
    繁华的城市夜景
    
    # 多列格式（自动识别 prompt 列）
    prompt,category,mood
    美丽的日落风景,自然,宁静
    繁华的城市夜景,城市,热闹
    ```
  - 点击 `导入 CSV` 按钮选择文件

**图片准备**
- 选择图片文件夹（支持多选）
- 建议图片命名：`001.jpg`, `002.jpg`, `003.jpg` 等（按数字顺序）
- 支持的图片格式：JPG, PNG, GIF, WebP
- 图片数量应与提示词数量匹配

#### 2. 配置参数

**生成模式选择**
- **帧转视频** (Frames to Video)
  - 需要上传图片
  - 自动处理图片裁剪
  
- **素材转视频** (Ingredients to Video)
  - 需要上传图片
  - 自动处理图片裁剪
  
- **文本转视频** (Text to Video)
  - 无需上传图片
  - 仅使用提示词生成

**裁剪模式选择**
- **竖版 (9:16)** - 适合手机屏幕、短视频
- **横版 (16:9)** - 适合电脑屏幕、常规视频

#### 3. 启动队列

1. 检查预览区域，确认任务配置正确
2. 点击 `开始队列` 按钮
3. 扩展将自动执行以下步骤：
   - ✅ 智能模式匹配和切换
   - ✅ 条件性图片上传（仅需要时）
   - ✅ 自动裁剪处理
   - ✅ 提示词自动输入
   - ✅ 任务提交和队列管理
   - ✅ 视频生成等待
   - ✅ 自动下载和重命名

#### 4. 监控进度

**状态指示器**
- 🟢 **运行中** - 队列正在处理
- 🟡 **已暂停** - 队列已暂停
- 🔴 **错误** - 发生错误
- ⚪ **空闲** - 队列未启动

**进度信息**
- 当前任务索引：`任务 X / 总数`
- 成功计数：已完成的任务数
- 失败计数：失败的任务数
- 队列状态：`队列 X / 5`（当前队列占用情况）

**日志系统**
- 实时显示操作日志
- 支持错误、警告、信息三种日志级别
- 自动滚动到最新日志

#### 5. 队列控制

**暂停队列**
- 点击 `暂停队列` 按钮
- 当前任务完成后暂停
- 可随时恢复

**清空队列**
- 点击 `清空队列` 按钮
- 停止所有任务
- 清除所有状态

---

## 🏗️ 技术架构

### 架构概览

```
┌─────────────────────────────────────────┐
│         Chrome Extension                │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐  ┌──────────┐           │
│  │  Popup   │  │ Content  │           │
│  │   UI     │  │  Script  │           │
│  └────┬─────┘  └────┬─────┘           │
│       │             │                  │
│       └──────┬──────┘                  │
│              │                         │
│       ┌──────▼──────┐                  │
│       │ Background  │                  │
│       │  Service    │                  │
│       │  Worker     │                  │
│       └─────────────┘                  │
│                                         │
└─────────────────────────────────────────┘
```

### 核心组件

#### 1. Popup Script (`popup.js`)
- **职责**: 用户界面交互和状态管理
- **功能**:
  - UI 状态管理
  - 文件选择和预处理
  - 任务配置和元数据管理
  - 实时状态显示和日志

#### 2. Content Script (`content.js`)
- **职责**: 页面自动化操作
- **功能**:
  - DOM 元素识别和操作
  - 模式切换和验证
  - 文件上传和裁剪处理
  - 任务队列管理和执行
  - 视频生成监控和下载

#### 3. Background Service Worker (`background.js`)
- **职责**: 后台任务处理
- **功能**:
  - 文件下载管理
  - 跨标签页通信
  - 持久化存储管理

### 技术栈

- **Manifest Version**: 3
- **JavaScript**: ES6+ (Async/Await, Classes, Modules)
- **Storage**: Chrome Storage API (Local Storage)
- **DOM Manipulation**: XPath, QuerySelector
- **File Handling**: FileReader API, Base64 Encoding

### 关键设计模式

#### 状态管理
- **原子更新**: 使用锁机制防止竞态条件
- **状态同步**: 内存状态与持久化存储同步
- **自动恢复**: 页面刷新后自动恢复状态

#### 错误处理
- **分层错误处理**: 不同层级独立的错误处理
- **自动重试**: 关键操作失败时自动重试
- **错误恢复**: 智能错误恢复机制

#### 性能优化
- **文件缓存**: 内存和 IndexedDB 双重缓存
- **批量操作**: 减少存储读写次数
- **延迟优化**: 智能延迟策略

---

## ⚙️ 配置说明

### 队列配置

扩展内置了优化的配置参数，位于 `content.js` 中的 `CONFIG` 对象：

```javascript
static CONFIG = {
  QUEUE_LIMIT: 5,                    // veo3 队列限制
  QUEUE_CHECK_INTERVAL: 500,         // 队列检查间隔（毫秒）
  QUEUE_STATUS_LOG_INTERVAL: 10,      // 状态日志输出间隔
  TASK_DELAY: 300,                    // 任务间延迟（毫秒）
  VIDEO_GENERATION_TIMEOUT: 90000,    // 视频生成超时（毫秒）
  VIDEO_LOAD_TIMEOUT: 5000,           // 视频加载超时（毫秒）
  ELEMENT_WAIT_INTERVAL: 200,         // 元素等待间隔（毫秒）
  CLICK_DELAY: 200,                   // 点击后延迟（毫秒）
  SCROLL_DELAY: 300,                  // 滚动后延迟（毫秒）
  PENDING_TASKS_WAIT: 5000            // 等待待处理任务时间（毫秒）
};
```

### 自定义配置

如需调整配置，请编辑 `content.js` 文件中的 `CONFIG` 对象：

```javascript
// 示例：增加队列检查频率
QUEUE_CHECK_INTERVAL: 300,  // 从 500ms 改为 300ms

// 示例：增加视频生成超时时间
VIDEO_GENERATION_TIMEOUT: 120000,  // 从 90秒 改为 120秒
```

---

## 🔧 故障排除

### 常见问题

#### 1. 扩展无法加载

**症状**: 扩展图标不显示或点击无反应

**解决方案**:
- 检查 Chrome 版本是否为 88+
- 确认已启用开发者模式
- 检查 `manifest.json` 文件是否完整
- 查看扩展管理页面的错误信息

#### 2. 模式切换失败

**症状**: 控制台显示模式切换错误

**解决方案**:
- 确认已正确访问 Google Labs Flow 页面
- 检查页面是否完全加载
- 查看控制台详细错误信息
- 尝试手动切换模式后重试

#### 3. 文件上传失败

**症状**: 图片无法上传或上传后无反应

**解决方案**:
- 检查图片格式（支持 JPG, PNG, GIF, WebP）
- 确认图片文件大小未超过限制
- 检查文件是否损坏
- 尝试使用其他图片文件

#### 4. 队列卡住不动

**症状**: 队列显示运行中但无进度

**解决方案**:
- 检查网络连接
- 查看控制台错误日志
- 尝试暂停后恢复队列
- 如问题持续，清空队列后重新开始

#### 5. 视频下载失败

**症状**: 视频生成完成但未下载

**解决方案**:
- 检查浏览器下载权限设置
- 确认下载文件夹有写入权限
- 检查磁盘空间是否充足
- 查看控制台错误信息

#### 6. 任务重复执行

**症状**: 同一任务被执行多次

**解决方案**:
- 清空队列并重新开始
- 检查是否有多个扩展实例运行
- 刷新页面后重新配置

### 调试模式

启用详细日志输出：

1. 打开 Chrome 开发者工具（F12）
2. 切换到 `Console` 标签
3. 查看以 `[FlowBatchPilot]` 开头的日志
4. 日志级别：
   - `[info]` - 一般信息
   - `[warning]` - 警告信息
   - `[error]` - 错误信息
   - `[success]` - 成功信息（绿色高亮）

### 获取帮助

如遇到无法解决的问题：

1. 检查 [GitHub Issues](https://github.com/your-repo/issues)
2. 查看控制台完整错误日志
3. 提供以下信息：
   - Chrome 版本
   - 扩展版本
   - 错误发生的具体步骤
   - 控制台错误日志截图

---

## 👨‍💻 开发指南

### 项目结构

```
FlowBatchPilot/
├── manifest.json          # 扩展清单文件
├── popup.html             # 弹出窗口 HTML
├── popup.js               # 弹出窗口逻辑
├── popup.css              # 弹出窗口样式
├── content.js             # 内容脚本（核心逻辑）
├── background.js          # 后台服务 Worker
├── README.md              # 项目文档
└── CODE_REVIEW.md         # 代码审查报告
```

### 开发环境设置

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd FlowBatchPilot
   ```

2. **加载扩展**
   - 按照 [快速开始](#-快速开始) 中的步骤加载扩展

3. **开发调试**
   - 修改代码后，在扩展管理页面点击 `重新加载` 按钮
   - 使用 Chrome 开发者工具调试

### 代码规范

- **命名规范**: 使用驼峰命名法（camelCase）
- **注释规范**: 关键逻辑必须添加注释
- **错误处理**: 所有异步操作必须包含错误处理
- **状态管理**: 使用原子操作更新状态

### 测试

1. **功能测试**
   - 测试各种模式切换
   - 测试文件上传和裁剪
   - 测试队列管理和恢复

2. **边界测试**
   - 测试空队列处理
   - 测试网络中断恢复
   - 测试页面刷新恢复

### 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📝 更新日志

### v1.0.0 (2025-01-XX)

#### 🎉 初始版本发布

**核心功能**
- ✅ 批量视频生成自动化
- ✅ 智能模式识别和切换
- ✅ 多种裁剪模式支持
- ✅ 自动下载和文件命名
- ✅ 队列管理和状态恢复

**技术特性**
- ✅ Manifest V3 支持
- ✅ 原子状态更新机制
- ✅ 完善的错误处理
- ✅ 性能优化和内存管理

**用户体验**
- ✅ 现代化的 UI 设计
- ✅ 实时进度监控
- ✅ 详细的日志系统
- ✅ CSV 文件导入支持

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 许可证。

```
MIT License

Copyright (c) 2025 FlowBatchPilot Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 致谢

- Google Labs Flow 团队提供的优秀平台
- Chrome Extensions API 文档
- 所有贡献者和用户的支持

---

## 📞 联系方式

- **项目主页**: [GitHub Repository](https://github.com/your-repo)
- **问题反馈**: [GitHub Issues](https://github.com/your-repo/issues)
- **功能建议**: [GitHub Discussions](https://github.com/your-repo/discussions)

---

<div align="center">

**Made with ❤️ by FlowBatchPilot Team**

⭐ 如果这个项目对你有帮助，请给我们一个 Star！

</div>
