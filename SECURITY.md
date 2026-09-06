# Security policy

## Scope

`netease-desktop-mcp` is a local stdio server that controls a Windows music client through its debug interface. It is intended for use by one trusted controller on the same computer.

The debug interface is a control capability, not a public API. Keep it bound to a loopback address. Do not expose it to a LAN, the internet, a reverse proxy, or an untrusted remote MCP client.

## Expected boundaries

- Do not request, extract, store, or log account passwords, cookies, tokens, or browser credentials.
- Use only the music-client target and the UI operations required by the requested action.
- Read-only status queries must not change playback or account data.
- A like/unlike request must include the current track's `trackKey`. Refuse the write when the track or like state is unknown or no longer matches.
- Do not treat an issued UI command as proof of a successful result. Check the resulting state where the operation supports verification.
- Keep stdout reserved for MCP protocol messages. Diagnostic output must not contain personal account data.

These are the project's intended implementation and contribution boundaries. Compatibility with a particular client version must be verified separately; a successful unit test run does not establish that boundary by itself.

`trackKey` is a hash of the currently visible track label, not a NetEase song ID. The label may omit artist or version information, and different recordings can share it. This check detects changes in visible text; it does not establish a unique recording identity. Playback verification also relies on visible labels and UI state. The adapter's behavior on a live NetEase Cloud Music 3.1.39 client has not yet been verified.

## Reporting a vulnerability

If the repository's **Security → Report a vulnerability** option is available, use it to report privately. Otherwise, open a minimal issue asking for a private reporting channel, without including exploit details, personal data, or credentials. Do not assume private vulnerability reporting is enabled.

Include the affected commit or release, Node.js and Windows versions, music-client version, expected behavior, observed behavior, and a minimal reproduction using non-sensitive data. Redact local usernames, absolute personal paths, song history, tokens, cookies, and account identifiers from any logs or screenshots.

Only the current default branch receives security fixes during early development. No response-time guarantee is offered.
