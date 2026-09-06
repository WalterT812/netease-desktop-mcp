# Security policy

## Scope

`netease-desktop-mcp` is a local stdio server that controls a Windows music client through its debug interface. It is intended for trusted controllers on the same computer, with one operation active at a time. Version 0.1.0-alpha.2 remains an early development release.

The debug interface is a control capability, not a public API. Keep it bound to a loopback address. Do not expose it to a LAN, the internet, a reverse proxy, or an untrusted remote MCP client.

## Expected boundaries

- Do not request, extract, store, or log account passwords, cookies, tokens, or browser credentials.
- Use only the music-client target and the UI operations required by the requested action.
- Read-only status queries must not change playback or account data.
- A like/unlike request must include the current track's `trackKey`. Refuse the write when the track or like state is unknown or no longer matches.
- Do not treat an issued UI command as proof of a successful result. Check the resulting state where the operation supports verification.
- Keep stdout reserved for MCP protocol messages. Diagnostic output must not contain personal account data.
- Serialize complete operations within an MCP session. A Windows named pipe, scoped to the debug port, provides cross-process exclusion for the duration of each operation. Release it after the operation; the operating system reclaims it when the process exits. The pipe carries no control commands or account data.
- Closing the MCP connection must not close the music client.
- Input EOF, transport closure, or termination stops queued operations and prevents adapter reconnection. The active operation retains its lease until it settles; already dispatched UI actions cannot be undone by disconnecting.

These are the project's intended implementation and contribution boundaries. Compatibility with a particular client version must be verified separately; a successful unit test run does not establish that boundary by itself.

`trackKey` is a hash of the currently visible track label, not a NetEase song ID. The verified layout supplies separate visible title and artist fields, which are combined into the label. Different recordings can still share that label, and information absent from the UI cannot be inferred. This check detects changes in visible text; it does not establish a unique recording identity. Playback verification also relies on visible labels and UI state.

## Verification scope

On Windows NetEase Cloud Music 3.1.39.205426, official SDK stdio checks verified separate title/artist reads, playback and heart-state reads, search, playing a search result, pause/play, and next/previous track. The original track and paused state were restored after the check. **Like/unlike writes have not been tested on the live client.** UI verification does not prove audible output or server-side persistence.

The adapter recognizes the verified layout's controls by `data-log` `oid` values within `default-bar-wrapper`, and obtains labels from `.title` and `.author`. Future client layouts require separate verification. Automated tests have run on Windows with Node.js 24; Linux has not been validated, and the supplied GitHub Actions workflow is an inactive template.

## Reporting a vulnerability

If the repository's **Security → Report a vulnerability** option is available, use it to report privately. Otherwise, open a minimal issue asking for a private reporting channel, without including exploit details, personal data, or credentials. Do not assume private vulnerability reporting is enabled.

Include the affected commit or release, Node.js and Windows versions, music-client version, expected behavior, observed behavior, and a minimal reproduction using non-sensitive data. Redact local usernames, absolute personal paths, song history, tokens, cookies, and account identifiers from any logs or screenshots.

Only the current default branch receives security fixes during early development. No response-time guarantee is offered.
