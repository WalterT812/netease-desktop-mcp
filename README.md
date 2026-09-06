# netease-desktop-mcp

让 AI 通过本地 MCP 控制 Windows 网易云音乐客户端：查看当前歌曲、搜索点播、控制播放和切歌，以及给当前歌曲加红心。

A local stdio MCP server for controlling the NetEase Cloud Music desktop app on Windows, using native WebSocket CDP without ChromeDriver or cookie extraction.

这是独立社区项目，与网易云音乐及网易公司无隶属或合作关系。当前版本为 **0.1.0-alpha.8**，处于早期开发阶段。在 **Windows 网易云音乐 3.1.39.205426** 上，已通过官方 MCP SDK stdio 实机验证后台搜索、指定歌曲加入自建歌单及成员读回；早期版本另验证过状态读取、点播、播放/暂停和上一首/下一首。**alpha.8 改用后台点播路径，该路径尚未实机播放验收；红心写入也尚未实机测试。** 客户端更新可能改变界面结构并影响兼容性。

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

## 当前能力

| MCP 工具 | 用途 |
| --- | --- |
| `netease_show_player` | 在支持 MCP Apps 的宿主中打开原生音乐卡片 |
| `netease_seek` | 按秒定位当前歌曲，绑定歌曲 ID 并读取进度核验 |
| `netease_set_volume` | 设置网易云应用音量（0–100），不改变系统音量 |
| `netease_get_player` | 只读歌曲 ID、封面、歌词及当前播放状态，供卡片刷新 |
| `netease_get_status` | 读取当前歌曲及播放、红心状态 |
| `netease_search` | 搜索歌曲，取得可用于点播的结果 |
| `netease_play_result` | 播放搜索结果 |
| `netease_set_playback` | 设置播放或暂停 |
| `netease_skip_track` | 上一首或下一首 |
| `netease_set_liked` | 设置当前歌曲的红心状态；写入尚未实机测试 |
| `netease_create_playlist` | 创建空的自建歌单，默认私人，可核验 ID、权限与保留结果 |
| `netease_list_playlists` | 刷新自建、收藏及系统歌单，无需切换页面 |
| `netease_get_playlist_tracks` | 从客户端 API 读取歌单的精确歌曲 ID，核对完整数量后分页返回 |
| `netease_add_tracks_to_playlist` | 将精确歌曲 ID 加入指定自建歌单，跳过已有歌曲并读回验证 |
| `netease_prepare_playlist_delete` | 核对自建歌单 ID 和名称，生成短期删除预览 |
| `netease_delete_playlist` | 消费一次性预览，删除指定自建歌单并检查保留结果 |

红心操作必须携带从当前状态取得的 `trackKey`。无法确认当前歌曲或红心状态时，工具拒绝修改，避免误操作其他歌曲。它提供“设置为喜欢 / 不喜欢”的语义，不盲目切换按钮。

**`trackKey` 是客户端当前可见歌曲标签的哈希，不是网易云歌曲唯一 ID。** 在已验证的新布局中，分别读取可见歌曲名和歌手，再组成标签。它可以发现标签变化，但无法区分标签相同的不同歌曲或录音版本，也无法补全界面未显示的信息。红心和切歌工具保留这一限制；alpha.8 的搜索点播另外核对实际歌曲 ID。不应把 `trackKey` 当作跨歌曲版本或跨会话的可靠身份凭证。

目前不包含取消收藏他人歌单、账号管理、下载音乐或完整听歌历史分析。每个 MCP 会话内部按顺序执行完整操作；Windows 命名管道提供按调试端口区分的跨进程互斥，同一时间只允许一个控制操作。操作结束立即释放，进程退出时由系统回收，不会留下需要手动删除的锁文件。另一个会话正在操作时会返回忙碌错误；请等它结束，并避免同时手动改变被操作的歌曲或歌单。

## 后台搜索与添加歌曲

`netease_search` 通过已登录桌面客户端的固定 API 搜索，请求关闭客户端缓存，直接将查询与同一次响应绑定。结果包含 `id`、`title`、`artists`、`album` 和 `durationMs`；搜索不输入按键、不抢焦点、不切换页面，也不改变播放。依赖已核验的客户端构建及其已加载模块，未知构建会拒绝操作；不读取密码或 Cookie，也不开放任意 API 调用。

`netease_play_result` 消费本会话最近一次搜索的两分钟 token，重新核对歌曲 ID、标题、歌手和专辑，再派发一次固定播放 action。核验时必须读到该歌曲 ID 正在播放；请求失败或不确定时不能自动重放。该操作把选中曲目加入现有播放队列，不会清空队列或约束后续自动播放。新路径已通过合成测试，尚未实机切歌验收。

设置 `NETEASE_ENABLE_PLAYLIST_ADD=1` 后可使用 `netease_add_tracks_to_playlist`，参数为：

```json
{
  "playlistId": "123456789",
  "expectedName": "目标歌单的完整名称",
  "trackIds": ["1234567", "2345678"]
}
```

示例 ID 需替换为实际搜索结果及歌单 ID，均使用字符串；每次最多 50 个不同歌曲 ID。工具在写入前核对登录账号、歌单归属、名称、隐私和完整成员，拒绝系统歌单、收藏歌单及 `NETEASE_PROTECTED_PLAYLIST_IDS` 中的歌单。只添加缺少的 ID，随后关闭客户端缓存读取完整成员，核对结果恰好等于原成员加上所选歌曲。返回 `verified`、`addedIds`、`alreadyPresentIds` 和 `trackCount`；这些核验不改变播放、音量或红心。

独立读回使用 `netease_get_playlist_tracks`，参数为 `playlistId`、可选 `offset`（默认 0）和 `limit`（默认 100，最多 1000）。工具先确认完整 ID 数量与歌单总数一致，再返回分页；`complete` 仅在该页包含全部成员时为真。

响应丢失或成员读回不一致时返回不确定结果，不自动重发添加。当前进程保留原请求，后续相同请求只允许读回恢复；不同请求不能绕过该状态。此记录不跨进程持久化，重启不是重试授权。核验依赖客户端 API 响应，不是独立抓包证明，也不阻止其他设备同时改动歌单。

## 进度与音量

播放器快照包含 `positionSeconds`、`volumePercent` 和 `canSeek`。进度读取已适配构建的歌曲滑块，音量读取客户端播放器状态；未知时保持 `null`。`netease_seek` 在执行前核对歌曲 ID、时长、进度控件和加载状态，试听/不支持的状态拒绝定位。两个写入工具仅提交一次固定客户端 action，再读取进度或音量核验，不会自动重发；核验不代表已听到声音。实机只读与合成写入测试通过，拖动写入仍需用户实际操作验证。

## 原生音乐卡片（MCP Apps）

让 AI 调用 `netease_show_player`，例如：“打开网易云播放器”。它通过本地 stdio MCP 返回 `ui://netease/player-v1.html`，无需另起 HTTP 服务。兼容宿主可显示封面、歌曲、歌词、播放控制和输入框；只有文字 MCP 的客户端仍可读取歌曲结果。

- 卡片通过 `netease_get_player` 刷新，不重复创建新卡片。封面只允许网易云图片域名，文字按纯文本显示；未知状态不猜测。
- 输入框用标准 `ui/message` 发给卡片所在的原任务，回复仍显示在原聊天。未提供消息能力的宿主会禁用发送；超时保留草稿并停止重复提交。
- “收藏到歌单”列出自建歌单并将选中的歌曲 ID 与歌单 ID 交给 AI。卡片提交请求后，由 AI 调用已启用的 `netease_add_tracks_to_playlist`；只有工具读回验证成功才能称为已收藏，不能把消息发送成功当作已收藏。
- 播放、切歌和红心按钮调用现有控制器，继承其状态核验与兼容性限制。曲目 ID 来自当前已验证客户端构建的只读 store 投影；歌词格式不支持时显示未知，纯音乐无歌词时显示空状态。
- 可展开模式取决于宿主提供的能力，不保证独立桌面悬浮或跨任务固定。

alpha.5 已通过 64 项自动测试，包括 SDK 资源注册、UI 消息去重、草稿保留、切歌身份校验、滚动标题与红心图标识别；Codex 原生 MCP 已实机读取歌曲 ID、HTTPS 封面和播放状态。**真实卡片挂载与卡片输入到原任务的端到端交互尚待实机确认**，不能用协议测试代替界面验收。

## 创建歌单（可选启用）

设置 MCP 环境变量 `NETEASE_ENABLE_PLAYLIST_CREATE=1` 后，可使用 `netease_create_playlist`。传入 `name`（最长 40 字符），`isPrivate` 默认 `true`。创建前必须有用户授权；私人歌单需经用户要求才改用公开创建。工具拒绝同名歌单，核验新 ID、归属、隐私、零曲目数和其他歌单保留结果。不确定的结果不会自动重试，同一进程也会阻止以相同名称再次创建。这里只建立空歌单，不隐含添加当前歌曲。

## 歌单删除（可选启用）

默认禁用删除。明确需要此能力时，在 MCP 进程配置中设置：

```json
{
  "NETEASE_ENABLE_PLAYLIST_DELETE": "1",
  "NETEASE_PROTECTED_PLAYLIST_IDS": "123456789,987654321"
}
```

示例 ID 必须替换成自己要保留的歌单 ID。所有收藏歌单和系统“我喜欢的音乐”自动受保护；额外保护名单来自本地环境变量，不能通过工具参数覆盖。工具清单的危险操作标注只是提示，真正的拒绝检查在控制器和客户端页面两层执行。

使用顺序：读取清单 → 以 ID 和完整名称生成预览 → 获得用户明确授权 → 将预览的 `deleteToken` 传给执行工具的 `token` 参数。预览绑定登录账号、歌单 ID、名称、曲目数和更新时间，两分钟后过期，发送删除前即消费；没有批量删除或自动重试入口。执行后刷新清单，检查目标消失以及其他自建、收藏和系统歌单的信息保持一致。失败或连接中断时应先检查实际结果；同一进程会阻止对结果不确定的 ID 再次生成预览。该阻止记录不跨进程持久化，重启不能视作重试授权。

此能力调用客户端自身的歌单操作，通过本机 CDP 读取 React store 并派发固定 action，不用鼠标、键盘、右键菜单或窗口焦点。当前只允许已核验的 `app.chunk.d4e863d.js` 客户端构建；这是非公开接口兼容性限制，不是文件真实性验证。客户端升级后若构建变化，先拒绝操作，待重新适配。

删除歌单可能无法撤销。建议先保留曲目记录；曲目清单不能恢复原歌单 ID、关注者和历史数据。保护与核验基于客户端刷新后的歌单元数据，没有逐首比对所有保留歌单的曲目，也不阻止用户或其他程序同时修改账号。

## 环境要求

- Windows 10 或 Windows 11，以及已安装的网易云音乐桌面客户端。
- Node.js **24 或更高版本**，附带 npm。
- 支持本地 stdio MCP 的 AI 客户端。

真实音乐控制需要 Windows 网易云客户端。自动测试已在 Windows / Node.js 24 上运行；Linux 尚未运行验收，GitHub Actions 尚未启用。自动测试与客户端实机兼容性是不同的验收范围。

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

默认调试端口为 `9229`；脚本支持 `-Port 9229`。这些命令供用户在自己的电脑上按需执行；除已验证的版本外，其他客户端版本是否接受调试参数仍需确认。

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

关闭 MCP 会断开控制连接，不会关闭网易云客户端。重启网易云至正常模式可以结束本次调试会话。安全问题的报告方式见 [SECURITY.md](SECURITY.md)。

## 验证范围

alpha.8 已通过 86 项自动测试，覆盖查询与响应对应、异步搜索、账号归属、精确 ID、成员完整性、去重、保护名单、写入丢失回复与只读恢复。SDK stdio 实机连续交替查询两首不同歌曲，返回对应的独立结果；在获授权的私人自建歌单中加入一首精确歌曲 ID，独立读回确认，重复调用未重复添加。验收前后歌曲 ID、播放状态、音量和播放模式相同，其余收藏歌单及系统喜欢歌单的元数据保持一致；未逐首比对所有保留歌单。新后台点播仅做合成测试，本次实机验收未改变播放。

alpha.3 已通过官方 SDK stdio 实机验证完整歌单读取及用户明确授权的自建歌单删除，并核对其余歌单 ID、名称、曲目数和更新时间；没有使用原生桌面输入。自动测试覆盖 47 项，包括权限默认关闭、保留名单、账号与歌单变化、过期及重复 token、错误结果和协议结构。

Windows 网易云音乐 **3.1.39.205426** 已通过官方 SDK stdio 实机检查：分别读取歌曲名/歌手、播放状态和红心状态，搜索、点播、暂停/继续播放，以及双向切歌。检查结束后已恢复检查前的曲目和暂停状态，未进行红心写入。这里的播放成功表示客户端界面状态核验成功，不保证音频设备实际发声，也不证明收藏已持久化到服务器。

适配器在新布局的 `default-bar-wrapper` 内按 `data-log` 的 `oid` 定位红心、上一首和下一首按钮，避免依赖按钮排列顺序；歌曲标签来自独立的 `.title` 与 `.author`。这些实现依据只适用于相应布局，不能推定后续版本兼容。

## 开发与贡献

实现使用 JavaScript ESM、官方 `@modelcontextprotocol/sdk`、Zod 和 Node.js 原生 WebSocket。提交前运行 `npm test`。涉及 UI 定位或客户端兼容性的改动，请说明 Windows 版本、网易云版本、复现步骤和实机验证范围；不要提交账号信息、Cookie、个人歌曲历史或未经脱敏的调试日志。

本地自动测试覆盖合成 DOM、控制器、连接与互斥逻辑，以及官方 SDK 的内存 transport 和 stdio 协议。GitHub Actions **尚未启用**，Windows/Linux 工作流模板位于 [docs/ci-workflow.yml](docs/ci-workflow.yml)。有工作流写入权限的维护者可将模板放入 `.github/workflows/test.yml` 后启用。不要把该模板的存在视为 CI 已通过。

本项目参考了 [Ocrosoft/NetEaseMusic-MCP](https://github.com/Ocrosoft/NetEaseMusic-MCP) 的功能设计与界面定位思路，独立实现直接 CDP 连接，不使用其 ChromeDriver 控制实现。相关致谢和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

[MIT](LICENSE) · Copyright (c) 2026 Walter Tang and contributors.

Sidecar 音乐适配器提供循环模式切换：调用原生可见按钮一次，再读取模式确认。支持顺序播放、列表循环、单曲循环与随机播放；过期状态与未确认结果不会自动重试。
