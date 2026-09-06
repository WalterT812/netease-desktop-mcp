# Security policy

## Scope

`netease-desktop-mcp` is a local stdio server that controls a Windows music client through its debug interface. It is intended for trusted controllers on the same computer, with one operation active at a time. Version 0.1.0-alpha.4 remains an early development release.

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

## Playlist creation boundaries

Creation is disabled unless NETEASE_ENABLE_PLAYLIST_CREATE=1. It creates one empty private playlist by default, refuses an existing exact name, and binds the dispatch to the current account. Success requires the returned ID to identify exactly one new owned empty playlist with the requested privacy, with the earlier library retained. Unknown results are blocked by name in the current process; there is no automatic retry or durable cross-process deduplication. Creating a playlist does not authorize adding any track.

## Playlist deletion boundaries

Deletion is off unless NETEASE_ENABLE_PLAYLIST_DELETE=1. System liked playlists, collected playlists, unowned entries and NETEASE_PROTECTED_PLAYLIST_IDS are refused in both controller and page checks. A preview binds account, ID, name, track count and update time. Tokens expire after two minutes and are consumed before dispatch. Failed or uncertain writes block new previews for that ID within the current process; this block is not persisted across restarts. Never infer permission to retry from a restart.

The page bridge uses a fixed own-playlist action and never accepts arbitrary dispatch types or collection-unsubscribe parameters. It requires the tested app bundle identifier and expected React store structure. A matching bundle filename is a compatibility check, not cryptographic authenticity. No native input or focus is used for playlist tools. Account identity is read internally only to bind operations and is omitted from tool results. Passwords, cookies and session storage are not read.

Success requires a refreshed list without the target and matching retained playlist IDs, names, track counts and update times. This is metadata verification, not a per-track integrity audit. Client refresh failure or concurrent manual changes can prevent reliable verification. There is no transaction spanning the controller and remote service. A track-list backup cannot restore playlist IDs or followers. MCP annotations are hints; runtime checks enforce the restrictions. User authorization must be obtained by the trusted controller before execution.

## Verification scope

On Windows NetEase Cloud Music 3.1.39.205426, official SDK stdio checks verified separate title/artist reads, playback and heart-state reads, search, playing a search result, pause/play, and next/previous track. The original track and paused state were restored after the check. **Like/unlike writes have not been tested on the live client.** UI verification does not prove audible output or server-side persistence.

The adapter recognizes the verified layout's controls by `data-log` `oid` values within `default-bar-wrapper`, and obtains labels from `.title` and `.author`. Future client layouts require separate verification. Automated tests have run on Windows with Node.js 24; Linux has not been validated, and the supplied GitHub Actions workflow is an inactive template.

## Reporting a vulnerability

If the repository's **Security → Report a vulnerability** option is available, use it to report privately. Otherwise, open a minimal issue asking for a private reporting channel, without including exploit details, personal data, or credentials. Do not assume private vulnerability reporting is enabled.

Include the affected commit or release, Node.js and Windows versions, music-client version, expected behavior, observed behavior, and a minimal reproduction using non-sensitive data. Redact local usernames, absolute personal paths, song history, tokens, cookies, and account identifiers from any logs or screenshots.

Only the current default branch receives security fixes during early development. No response-time guarantee is offered.
