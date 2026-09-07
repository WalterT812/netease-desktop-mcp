# Security policy

## Scope

`netease-desktop-mcp` is a local stdio server that controls a Windows music client through its debug interface. It is intended for trusted controllers on the same computer, with one operation active at a time. Version 0.1.0-alpha.11 remains an early development release.

The debug interface is a control capability, not a public API. Keep it bound to a loopback address. Do not expose it to a LAN, the internet, a reverse proxy, or an untrusted remote MCP client.

## Expected boundaries

- Do not request, extract, store, or log account passwords, cookies, tokens, or browser credentials.
- Use only the music-client target and fixed UI or background API operations required by the requested action.
- Read-only status queries must not change playback or account data.
- A like/unlike request must include the current track's `trackKey`. Refuse the write when the track or like state is unknown or no longer matches.
- Do not treat an issued UI command as proof of a successful result. Check the resulting state where the operation supports verification.
- Keep stdout reserved for MCP protocol messages. Diagnostic output must not contain personal account data.
- Serialize complete operations within an MCP session. A Windows named pipe, scoped to the debug port, provides cross-process exclusion for the duration of each operation. Release it after the operation; the operating system reclaims it when the process exits. The pipe carries no control commands or account data.
- Closing the MCP connection must not close the music client.
- Input EOF, transport closure, or termination stops queued operations and prevents adapter reconnection. The active operation retains its lease until it settles; already dispatched UI actions cannot be undone by disconnecting.

These are the project's intended implementation and contribution boundaries. Compatibility with a particular client version must be verified separately; a successful unit test run does not establish that boundary by itself.

`trackKey` is a hash of the currently visible track label, not a NetEase song ID. The verified layout supplies separate visible title and artist fields, which are combined into the label. Different recordings can still share that label, and information absent from the UI cannot be inferred. This check detects changes in visible text; it does not establish a unique recording identity. Like and skip verification retain this limitation. Background catalog playback additionally verifies the selected exact song ID; alpha.10 live acceptance confirmed that path after supplying required source metadata.

## Catalog and playlist member boundaries

Search uses a fixed cached client API module with client caches disabled, correlating each response with its own query. It does not navigate, inject input or change playback. A disposable Webpack loader entry is removed immediately after capturing the already-loaded fixed module. Unknown builds or module shapes refuse the operation; the bundle filename remains a compatibility check, not authenticity evidence. Arbitrary endpoints, account credentials and storage access are not exposed.

Adding tracks requires NETEASE_ENABLE_PLAYLIST_ADD=1 and explicit user authorization. The bridge checks exact string IDs, full playlist name, current account ownership, system/collected/protected status and complete original members. Only missing selected IDs are sent, in at most one add request. Success requires an uncached client API readback whose complete member set exactly matches original members plus selected tracks, with ownership, name and privacy retained. This is client API evidence, not an independent network audit or a transaction excluding other devices.

An uncertain add retains the bound request in the current process. A repeated identical request can only read back; it never resends the mutation. Other requests for that playlist remain blocked. This record is not durable across process restarts; neither restarting nor losing a response authorizes another write. Native requests already sent may continue after a transport timeout. Read actual membership before considering any later action. Search-result playback also consumes its token before dispatch, checks exact metadata and leaves the existing queue intact; it must not automatically retry.

## Lyric projection boundaries

Player snapshots request only the currently playing exact catalog ID through the fixed client lyric API and its already-loaded formatter. They recheck identity after the request and after joining player state. No arbitrary endpoint, native lyric-window toggle, playback action or contributor profile is exposed. Only bounded lyric text, timestamps and aligned translations are projected. Both original and translated text render through textContent, never HTML.

Each player instance keeps at most one current-song lyric projection, with a ten-minute success cache and a fifteen-second missing/error cooldown. A failed request remains unavailable; it is not evidence of instrumental music. The current line is recomputed from fresh playback position. The fixed client build and formatter are compatibility dependencies; unsupported formats or inconsistent identities fail closed. Unit tests verify these boundaries; live SDK readback confirms data, not visibility in a separate host UI.

## Playlist playback boundaries

Playlist playback requires user authorization to replace the current queue and start its first song in sequential mode. The fixed bridge reads fresh complete playlist members, resolves exact song IDs, rechecks order/account/metadata, and dispatches at most one mode change and one playback action. Only ordinary music modes and 1–200 tracks are supported; listen-together, FM, AI and ambiguous mixed queues are refused before dispatch. Existing protected-playlist membership remains untouched; a membership protection rule does not prohibit authorized playback.

Success requires the complete actual queue in display order to exactly match playlist members, the first exact ID to be playing, sequential mode and unchanged raw volume. Missing or substituted tracks, changed members or unknown responses cannot silently pass. The controller blocks another playlist-play dispatch after an uncertain outcome in the same process; read the queue and do not restart to bypass this state. This is observed client state, not a lock against subsequent changes, an audible-output test or a promise that future tracks will remain available. alpha.9 live acceptance replaced a 102-track queue with an authorized 15-track playlist, verified its first song playing and all queue IDs in order, and independently re-read membership and unchanged volume without desktop input.

## Playlist creation boundaries

Creation is disabled unless NETEASE_ENABLE_PLAYLIST_CREATE=1. It creates one empty private playlist by default, refuses an existing exact name, and binds the dispatch to the current account. Success requires the returned ID to identify exactly one new owned empty playlist with the requested privacy, with the earlier library retained. Unknown results are blocked by name in the current process; there is no automatic retry or durable cross-process deduplication. Creating a playlist does not authorize adding any track.

## Playlist deletion boundaries

Deletion is off unless NETEASE_ENABLE_PLAYLIST_DELETE=1. System liked playlists, collected playlists, unowned entries and NETEASE_PROTECTED_PLAYLIST_IDS are refused in both controller and page checks. A preview binds account, ID, name, track count and update time. Tokens expire after two minutes and are consumed before dispatch. Failed or uncertain writes block new previews for that ID within the current process; this block is not persisted across restarts. Never infer permission to retry from a restart.

The page bridge uses a fixed own-playlist action and never accepts arbitrary dispatch types or collection-unsubscribe parameters. It requires the tested app bundle identifier and expected React store structure. A matching bundle filename is a compatibility check, not cryptographic authenticity. No native input or focus is used for playlist tools. Account identity is read internally only to bind operations and is omitted from tool results. Passwords, cookies and session storage are not read.

Success requires a refreshed list without the target and matching retained playlist IDs, names, track counts and update times. This is metadata verification, not a per-track integrity audit. Client refresh failure or concurrent manual changes can prevent reliable verification. There is no transaction spanning the controller and remote service. A track-list backup cannot restore playlist IDs or followers. MCP annotations are hints; runtime checks enforce the restrictions. User authorization must be obtained by the trusted controller before execution.

## Verification scope

alpha.10 passed 95 automated tests, including a regression that failed for missing native source metadata before the fix. A single authorized SDK search-result play then succeeded with the exact selected catalog ID; independent player and queue reads confirmed playing=true. Raw volume, mode, original queue relative order and the separately checked playlist membership were preserved. No automatic replay, native desktop input or app restart was used.

alpha.8 passed 86 automated tests and live SDK stdio checks for background search correlation, exact-ID addition to one authorized private playlist, independent member readback and duplicate prevention. Playback identity, playing state, volume and mode were unchanged by that acceptance. Preserved collections were compared by metadata, not every track. Native Codex MCP also successfully read the added member and a distinct search result. New background search-result playback has synthetic coverage only; it was not live-tested because this acceptance did not authorize changing playback.

On Windows NetEase Cloud Music 3.1.39.205426, official SDK stdio checks verified separate title/artist reads, playback and heart-state reads, search, playing a search result, pause/play, and next/previous track. The original track and paused state were restored after the check. **Like/unlike writes have not been tested on the live client.** UI verification does not prove audible output or server-side persistence.

The adapter recognizes the verified layout's controls by `data-log` `oid` values within `default-bar-wrapper`, and obtains labels from `.title` and `.author`. Future client layouts require separate verification. Automated tests have run on Windows with Node.js 24; Linux has not been validated, and the supplied GitHub Actions workflow is an inactive template.

## Reporting a vulnerability

If the repository's **Security → Report a vulnerability** option is available, use it to report privately. Otherwise, open a minimal issue asking for a private reporting channel, without including exploit details, personal data, or credentials. Do not assume private vulnerability reporting is enabled.

Include the affected commit or release, Node.js and Windows versions, music-client version, expected behavior, observed behavior, and a minimal reproduction using non-sensitive data. Redact local usernames, absolute personal paths, song history, tokens, cookies, and account identifiers from any logs or screenshots.

Only the current default branch receives security fixes during early development. No response-time guarantee is offered.
