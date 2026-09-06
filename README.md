# netease-desktop-mcp

让 AI 通过本地 MCP 控制 Windows 网易云音乐客户端：查看当前歌曲、搜索点播、控制播放和切歌，以及给当前歌曲加红心。

A local stdio MCP server for controlling the NetEase Cloud Music desktop app on Windows, using native WebSocket CDP without ChromeDriver or cookie extraction.

这是独立社区项目，与网易云音乐及网易公司无隶属或合作关系。当前版本为 **0.1.0-alpha.1**，处于早期开发阶段。自动化验收范围为合成 DOM、MCP 协议及控制器测试；**网易云音乐 3.1.39 的真机连接、播放和红心操作尚未验证**。客户端更新可能改变界面结构并影响兼容性。

## 工作方式

```text
支持 MCP 的 AI 客户端
        │ stdio
        ▼
netease-desktop-mcp
        │ 本机 WebSocket / Chrome DevTools Protocol
        ▼
Windows 网易云音乐客户端
```

音乐由网易云客户端播放，推荐和操作决策由连接的 AI 客户端完成。此项目操作客户端已有的界面与登录会话，不要求提供网易云密码，也不提取 Cookie。

## 首版能力

| MCP 工具 | 用途 |
| --- | --- |
| `netease_get_status` | 读取当前歌曲及播放、红心状态 |
| `netease_search` | 搜索歌曲，取得可用于点播的结果 |
| `netease_play_result` | 播放搜索结果 |
| `netease_set_playback` | 设置播放或暂停 |
| `netease_skip_track` | 上一首或下一首 |
| `netease_set_liked` | 设置当前歌曲的红心状态 |

红心操作必须携带从当前状态取得的 `trackKey`。无法确认当前歌曲或红心状态时，工具拒绝修改，避免误操作其他歌曲。它提供“设置为喜欢 / 不喜欢”的语义，不盲目切换按钮。

**`trackKey` 是客户端当前可见歌曲标签的哈希，不是网易云歌曲唯一 ID。** 它用于发现可见标签发生变化；标签内容取决于客户端界面，可能不包含完整歌手信息，也无法区分标签相同的不同歌曲或版本。切歌及点播的状态核验同样依赖这些可见信息。首版尚未真机验证这套识别方式，不应把 `trackKey` 当作跨歌曲版本或跨会话的可靠身份凭证。

首版不包含个人歌单增删、账号管理、下载音乐或完整听歌历史分析。同一时间只使用一个控制会话；操作期间请避免同时使用另一个 MCP 实例或手动改变页面。

## 环境要求

- Windows 10 或 Windows 11，以及已安装的网易云音乐桌面客户端。
- Node.js **24 或更高版本**，附带 npm。
- 支持本地 stdio MCP 的 AI 客户端。

单元测试可在 Windows 和 Linux 上运行；真实音乐控制需要 Windows 网易云客户端。CI 测试通过不等于所有客户端版本都已实机验证。

## 本地启动

在项目目录安装依赖并运行测试：

```powershell
npm ci
npm test
```

用启动脚本为网易云开启本机调试接口。将示例替换为自己的客户端路径：

```powershell
pwsh -File .\scripts\Start-CloudMusic.ps1 -CloudMusicPath 'D:\Apps\CloudMusic\cloudmusic.exe'
```

如果网易云已经运行且没有开启调试接口，可以明确要求脚本重启客户端。此操作会中断当前播放：

```powershell
pwsh -File .\scripts\Start-CloudMusic.ps1 -CloudMusicPath 'D:\Apps\CloudMusic\cloudmusic.exe' -Restart
```

默认调试端口为 `9229`；脚本支持 `-Port 9229`。这些命令供用户在自己的电脑上按需执行，项目不保证当前客户端版本接受调试参数。

启动 MCP 服务器前指定客户端可执行文件路径。Windows 上会校验调试端口归属，防止连接其他程序：

```powershell
$env:NETEASE_MUSIC_PATH = 'D:\Apps\CloudMusic\cloudmusic.exe'
$env:NETEASE_MCP_PORT = '9229'
npm start
```

`NETEASE_MUSIC_PATH` 为必填项；`NETEASE_MCP_PORT` 默认 `9229`，须与启动脚本一致。

服务器使用标准输入和标准输出传输 MCP 消息，不是网页服务；正常使用时应由 AI 客户端启动。

## 连接 AI 客户端

以下为通用 MCP JSON 配置示例。把路径替换为实际项目路径，并按所用客户端的配置格式填写：

```json
{
  "mcpServers": {
    "netease-desktop": {
      "command": "node",
      "args": ["D:\\Projects\\netease-desktop-mcp\\src\\server.mjs"],
      "env": {
        "NETEASE_MUSIC_PATH": "D:\\Apps\\CloudMusic\\cloudmusic.exe",
        "NETEASE_MCP_PORT": "9229"
      }
    }
  }
}
```

如果 AI 客户端无法从 `PATH` 找到 Node.js，请将 `command` 改成 `node.exe` 的绝对路径。先启动带调试接口的网易云，再连接 MCP。

连接后可以尝试：

- “现在放的是什么歌？”
- “搜索几首适合专注工作的音乐，把结果给我看看。”
- “播放搜索结果里的第一首。”
- “暂停一下。”
- “把当前这首加入我喜欢的音乐。”

## 命令行检查

项目也提供命令行入口，便于独立排查连接与操作问题：

```powershell
node .\src\cli.mjs status
node .\src\cli.mjs --help
node .\src\cli.mjs search "轻音乐"
node .\src\cli.mjs play "轻音乐" "1"
node .\src\cli.mjs playback pause
node .\src\cli.mjs skip next
```

命令包括 `status`、`search`、`play`、`playback`、`skip` 和 `like`。`play` 会重新搜索并播放指定行；独立 CLI 进程不共享搜索 token，重新搜索的排序也可能变化。需要严格对应已查看的结果时，请使用同一 MCP 会话中的搜索和点播工具。

红心命令格式为 `node .\src\cli.mjs like true <trackKey>`，取消红心则使用 `false`。将 `<trackKey>` 替换为刚刚查询的状态值，只在明确希望改变收藏时执行。更多参数以 CLI 帮助为准。

## 安全与兼容性

调试接口能够控制客户端页面。只应绑定本机回环地址，不要开放到局域网、配置公网转发或连接未知调试目标。不要把调试端点交给不信任的程序。

MCP 会把操作所需的歌曲信息返回给所连接的 AI 客户端。该客户端如何处理这些信息，由其设置和隐私政策决定。

自动化依赖网易云当前界面的可访问结构。找不到目标或无法确认状态时，应查看工具错误并检查客户端界面。请勿把播放请求已发出视为已实际听到声音；歌曲版权、会员权限及网络状态仍由网易云决定。

关闭 MCP 不应关闭网易云客户端。重启网易云至正常模式可以结束本次调试会话。安全问题的报告方式见 [SECURITY.md](SECURITY.md)。

## 开发与贡献

实现使用 JavaScript ESM、官方 `@modelcontextprotocol/sdk`、Zod 和 Node.js 原生 WebSocket。提交前运行 `npm test`。涉及 UI 定位或客户端兼容性的改动，请说明 Windows 版本、网易云版本、复现步骤和实机验证范围；不要提交账号信息、Cookie、个人歌曲历史或未经脱敏的调试日志。

首版已在 Windows / Node.js 24 上通过 27 项本地自动测试；Linux 尚未运行验收。GitHub Actions **尚未启用**，Windows/Linux 工作流模板位于 [docs/ci-workflow.yml](docs/ci-workflow.yml)。有工作流写入权限的维护者可将模板放入 `.github/workflows/test.yml` 后启用。不要把该模板的存在视为 CI 已通过。

本项目参考了 [Ocrosoft/NetEaseMusic-MCP](https://github.com/Ocrosoft/NetEaseMusic-MCP) 的功能设计与界面定位思路，独立实现直接 CDP 连接，不使用其 ChromeDriver 控制实现。相关致谢和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

[MIT](LICENSE) · Copyright (c) 2026 Walter Tang and contributors.
