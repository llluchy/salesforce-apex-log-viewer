# 快速开始指南

## 第一步：安装插件

1. 打开 Chrome，访问：`chrome://extensions/`
2. 开启右上角的 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择文件夹：`/workspace/salesforce-log-extension`

## 第二步：获取 OAuth Client ID

### 如果你有 Salesforce Connected App

1. 编辑 `background.js` 文件
2. 找到第 6 行：
   ```javascript
   const CLIENT_ID = 'YOUR_SALESFORCE_CONSUMER_KEY';
   ```
3. 将 `YOUR_SALESFORCE_CONSUMER_KEY` 替换为你的 Consumer Key

### 如果你没有 Connected App

#### 方法 1：使用 Salesforce DX/SFDX CLI

```bash
# 1. 安装 Salesforce CLI
npm install -g sfdx-cli

# 2. 登录 Salesforce
sfdx auth:web:login -d -a my-org

# 3. 查看已授权的组织
sfdx org:list

# 4. 获取 Consumer Key（需要手动在 Setup 中查看）
```

#### 方法 2：手动创建 Connected App

1. 登录你的 Salesforce org
2. 进入 **Setup** → **App Manager**
3. 点击 **New Connected App**
4. 填写基本信息
5. 启用 **OAuth Settings**
6. 配置 Callback URL（使用插件提供的 URL）
7. 选择 OAuth Scopes: `api`, `refresh_token`
8. 保存并复制 **Consumer Key**

## 第三步：配置并测试

1. 刷新 Chrome 插件页面
2. 点击插件图标
3. 点击 **"登录 Salesforce"**
4. 完成授权流程
5. 开始使用！

## 验证安装

- ✅ 插件图标显示正常
- ✅ 登录按钮可点击
- ✅ 授权流程正常跳转
- ✅ 登录后显示日志列表

## 常见问题排查

### 问题 1：OAuth 回调失败

**症状**：点击登录后提示回调失败

**解决方案**：
1. 检查 Callback URL 是否正确配置在 Connected App 中
2. 确保 Consumer Key 正确
3. 检查浏览器是否阻止了弹出窗口

### 问题 2：无法获取日志

**症状**：登录成功但日志列表为空

**解决方案**：
1. 确保在 Salesforce 中执行过 Apex 代码
2. 检查用户权限（需要访问 ApexLog 对象）
3. 查看 Salesforce Setup 中的 Debug Log 配置

### 问题 3：Token 过期

**症状**：一段时间后提示需要重新登录

**解决方案**：
- 插件会自动尝试刷新 Token
- 如果刷新失败，需要重新登录
- 确保 Connected App 配置了 refresh_token scope

## 下一步

- 探索日志详情功能
- 使用搜索和过滤
- 尝试导出日志
- 根据需要自定义代码
