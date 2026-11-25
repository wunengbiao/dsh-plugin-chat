# dsh-plugin-chat

[English](README.md) | 中文

给 DeepSeek Harness 加一个「对话模式」：侧边栏折叠按钮旁两段式开关，切过去就是一个只聊天的会话——不选目录、没有写代码工具、可以联网搜索、system prompt 可改。

```
🐟 deepseek HARNESS  ( 对话 | </> )  ⧉          ← 侧边栏标题行最右侧（三个按钮右边）
🐟 deepseek HARNESS  ⧉ │ 标题 对话模式              ← 会话标题行
                                                  （折叠成窄条时整条隐藏）
```

## 它做了什么

| 组成 | 类型 | 作用 |
|---|---|---|
| `shell.overlay` 项 | Client 插槽 | 开关本体：桌面端浮在侧边栏顶栏、紧贴折叠按钮左侧（位置按实测的按钮几何算） |
| `conversation.header.leading` 项 | Client 插槽 | 浏览器版（没有顶栏）时在会话头部 leading 格里排布 |
| `conversation.session.header.actions` 项 | Client 插槽 | 不渲染内容，只把「当前会话属于哪个模式」发出来 |
| `shell.overlay` 过滤项 | Client 插槽 | 一张样式表：按模式裁剪侧边栏、改标题与按钮、清掉用不上的控件 |
| `settings.section` 项 | Client 插槽 | 设置页：编辑对话模式的 system prompt |
| `dsh-plugin-chat` Host 行 | Host 插件 | 建对话工作区、两条 JSON 路由、给每个对话 Agent 加提示词段和工具白名单 |
| `preset-chat` 行 | Agent 预设 | 对话模式的能力集合：persona + 联网 + 提问 + 压缩，没有任何文件/shell/子代理工具 |

## 两个模式互相隔离

- **对话模式**：侧边栏隐藏所有工作区行和非对话会话，剩下的行去掉层级缩进，变成一条条对话记录；顶部标题从「工作区」变成「对话」，右上按钮从「添加工作区」变成「新建对话」；输入框上方的「工作区 / 模式」选择器、沙箱权限芯片、第三方模式芯片都隐藏。
- **写代码模式**：反过来隐藏「对话」工作区及其会话，其余一切保持宿主原样。

## 对话模式的能力

默认提示词要求模型用 `[[1]](url)` 这种带编号的 Markdown 链接引用来源，并在末尾列「来源」，所以正文里的 `[1]` 会渲染成网页版那种上标小徽章（圆角浅底 + 编号），鼠标停上去会弹出网页版那种来源卡片（站点、标题、摘要、链接），点一下直接打来源，而不是死方括号。

预设里只有 `persona`、`web_search`/`web_fetch`、`ask_user_question`、压缩、时间上下文；预设管不到的全局工具（MCP 服务器、工作目录切换）由 Host 端再加一道 `tools.restrict`，实测新会话只剩 3 个工具。

## 安装

```
plugin_manager action=install_bundle target=/绝对路径/dsh-plugin-chat
```

或把本仓库 clone 到本地后按上面的路径安装（插件目录安装是链接，改代码刷新即生效）。

## 配置

`cordis.patch.yml` 里的默认值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `systemPrompt` | 内置中文提示词 | 初始默认值，也是「恢复默认」的目标；设置页保存过的优先 |
| `workspaceDir` | `~/DSH-Chat` | 对话会话所在的目录 |
| `workspaceTitle` | `对话` | 侧边栏里这个工作区的名字 |

保存后的提示词存在 `$DSH_HOME/dsh-plugin-chat.json`（0600），每次装配时读取，所以改完下一条消息就生效、不用重启。

## 已知限制

- 侧边栏顶栏是宿主私有的（没有插槽、相邻格子会裁剪子元素），所以桌面端的开关是一个浮层控件，贴在折叠按钮左侧；它紧跟窗口尺寸和侧边栏宽度重算。
- 侧边栏折叠成窄条时整条开关隐藏，避免压住 macOS 红绿灯按钮。
- 过滤与文案替换是样式表层面的「视觉隐藏」，不改宿主 DOM；被隐藏的行仍在会话树里，键盘上下移动可能经过它们，顶部搜索也仍搜全部会话。
- 标题替换和「新建对话」按钮依赖宿主的 `data-sidebar-workspace-header` 标记与 `dsw-icon-project-add-outline-regular` 图标 id，宿主改这两处时替换会静默退化为原按钮。

详情页文档见 [docs/DETAIL.md](docs/DETAIL.md)。

## License

MIT
