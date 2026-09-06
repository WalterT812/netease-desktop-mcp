# Third-party notices

## NetEaseMusic-MCP

本项目参考 [Ocrosoft/NetEaseMusic-MCP](https://github.com/Ocrosoft/NetEaseMusic-MCP) 的功能设计与网易云客户端 UI 定位思路。直接 WebSocket CDP 连接及 MCP 服务实现独立编写，没有复制其 ChromeDriver 控制实现。

为保留上游署名与许可证信息，附上原项目的 [MIT License](https://github.com/Ocrosoft/NetEaseMusic-MCP/blob/main/LICENSE)：

```text
MIT License

Copyright (c) 2025 Ocrosoft

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

## Runtime dependencies

本项目使用官方 [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)（`@modelcontextprotocol/sdk`）和 [Zod](https://github.com/colinhacks/zod)。各依赖及其传递依赖适用各自随包提供的许可证；准确版本由 `package-lock.json` 固定。

网易云音乐、NetEase Cloud Music 及相关商标属于各自权利人。本项目不分发网易云客户端或音乐内容。
