# Salesforce Apex Log Viewer

一个强大的浏览器插件，用于实时查看和监控 Salesforce Apex 执行日志，支持多环境同时连接和切换。

## 🚀 主要功能

- **侧边栏模式**：不再是简单的弹窗，而是固定在浏览器侧边栏的完整应用
- **多环境支持**：同时连接多个 Salesforce 环境（Production、Sandbox、Test），并在它们之间快速切换
- **自动检测**：在 Salesforce 页面上打开侧边栏时，自动检测并连接当前环境
- **实时监控**：3秒自动刷新，实时获取最新的 Apex Log
- **搜索和过滤**：按日志类型、用户、操作等快速筛选
- **日志查看**：完整的日志内容查看，带语法高亮
- **导出功能**：下载日志为 JSON 文件

## 📦 安装说明

### 1. 加载插件到 Chrome

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择插件目录：`salesforce-log-extension`

### 2. 使用插件

1. 登录 Salesforce
2. 在任意 Salesforce 页面上，点击浏览器工具栏的插件图标
3. 插件侧边栏将自动打开，并显示连接按钮
4. 点击 **连接** 按钮，自动从当前页面提取 Session 并连接
5. 开始查看 Apex Log！

### 3. 多环境使用

1. 在不同的 Salesforce 环境页面上分别点击连接
2. 所有连接的环境都会出现在顶部的下拉菜单中
3. 在下拉菜单中选择环境即可切换
4. 点击 **断开** 按钮可以断开当前环境的连接

## 🎯 功能详解

### 连接和环境管理

- **自动连接**：在 Salesforce 页面上打开侧边栏时，自动检测可用的 Session
- **多环境**：连接多个环境后，可以在下拉菜单中快速切换
- **Session 恢复**：刷新浏览器后，之前连接的环境会自动恢复

### 日志列表

- **实时刷新**：默认 3 秒自动刷新，可以在设置中关闭
- **卡片显示**：每个日志显示为卡片，包含操作名称、用户、执行时间和大小
- **类型标签**：API、Batch、Callout、System 等不同类型的日志有不同的颜色
- **操作时间**：慢速操作（>1秒）和错误操作（>5秒）会有不同的颜色提示

### 日志详情

- **完整内容**：点击任意日志卡片，查看完整的日志内容
- **语法高亮**：ERROR、WARN、DEBUG、INFO 等不同级别的日志会有不同的颜色
- **元数据**：显示操作名称、应用、用户、执行时间等元数据
- **下载**：一键下载日志为 JSON 文件

## 🔧 技术说明

### 工作原理

插件不需要 OAuth 认证，而是直接使用浏览器中已登录的 Salesforce Session：

1. 通过 `chrome.scripting.executeScript` 在当前 Salesforce 页面执行脚本
2. 从 `document.cookie` 中提取 `sid`（Salesforce Session ID）
3. 使用 Session ID 调用 Salesforce REST API
4. 存储多个环境的 Session，支持切换

### 权限说明

插件需要以下权限：

- `storage`：存储环境配置和 Session（本地）
- `activeTab`：访问当前活动标签页
- `scripting`：在 Salesforce 页面执行脚本
- `cookies`：访问 Salesforce Cookie（可选，当前方案主要用 scripting）
- `sidePanel`：Chrome 侧边栏功能

### Salesforce API

- 使用 **Salesforce REST API** 查询 ApexLog
- API 版本：`v59.0`（最新稳定版）
- 主要查询：`SELECT ... FROM ApexLog ORDER BY StartTime DESC`

## ⚙️ 自定义配置

### 配置轮询间隔

在 `panel/panel.js` 中找到 `startPolling` 函数，修改 `interval` 参数：

```javascript
sendMessage({ action: 'start-polling', interval: 5000 }); // 5秒刷新
```

### 配置日志数量

在 `panel/panel.js` 中找到 `fetchLogs` 函数，修改 `limit` 参数：

```javascript
const response = await sendMessage({
  action: 'fetch-logs',
  limit: 100 // 最多获取 100 条日志
});
```

## 🐛 故障排除

### 无法连接

1. 确保已登录 Salesforce
2. 确保当前在 Salesforce 页面上（不是 chrome://extensions）
3. 尝试刷新 Salesforce 页面后重新连接

### 连接成功但看不到日志

1. 确保你的用户有访问 Apex Log 的权限
2. 在 Salesforce 中执行一些操作（如保存记录、执行触发器）来生成日志
3. 点击刷新按钮手动刷新

### Session 过期

Session 过期后，插件会自动断开连接，你需要：

1. 在 Salesforce 页面刷新，确保 Session 是最新的
2. 在插件中点击断开，然后重新连接

## 📝 开发者说明

### 项目结构

```
salesforce-log-extension/
├── manifest.json           # 插件配置文件
├── background.js           # 后台服务（Session 管理、API 调用）
├── panel/
│   ├── index.html          # 侧边栏页面
│   ├── panel.css           # 样式文件
│   └── panel.js            # UI 交互逻辑
└── icons/                  # 插件图标
```

### 主要组件

- **background.js**：管理多环境连接、API 请求、轮询
- **panel.js**：UI 渲染、用户交互、状态管理
- **panel.css**：界面样式和主题

### 扩展开发

想要添加新功能？以下是可能的改进方向：

- 日志分析和性能报告
- 错误告警和通知
- 日志比较功能
- 支持 SOQL 查询自定义日志
- 深色模式切换

## 📄 许可证

MIT License - 自由使用和修改

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
