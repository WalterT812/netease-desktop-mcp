# Client compatibility

## 0.1.0-alpha.3 — 2026-09-06

Same Windows/client version as alpha.2. The official SDK stdio client verified complete library refresh and explicitly authorized owned-playlist deletion without native input, navigation or focus. Retained playlist metadata and the system liked count were checked after each operation. This does not establish per-track integrity or heart-write persistence.

Playlist support is gated to app.chunk.d4e863d.js and the observed hostResource store structure. Unknown builds fail closed. Automated checks now include 47 tests: page-boundary protections, exact deletion dispatch, preview expiry and one-time use, stale account/playlist refusal, uncertain outcomes, preserved-library verification and SDK schemas.

## 0.1.0-alpha.2 — 2026-09-06

Tested on Windows 11 with Node.js 24 and NetEase Cloud Music **3.1.39.205426** (CEF Chromium 91). This is a single-client-version acceptance result, not a promise of compatibility with every configuration.

Live acceptance used the official MCP SDK client and real stdio server. Verified:

- Discovery and ownership validation of the loopback debug listener.
- Separate visible song title and artist, paused/playing state, and an unliked heart state.
- Search results and exact selection playback.
- Explicit pause/resume, next and previous track.
- Return to the initial track and initial paused state after testing.
- A second SDK session can reconnect after the first one closes; the music process continues running.

No heart mutation was performed. Like/unlike persistence and already-liked visual states still require live acceptance. No server-side library or account state was queried to verify the displayed heart. Track identity uses the visible title/artist label, not a catalog ID; identically labelled versions remain indistinguishable.

The current default player places heart controls outside the central transport buttons. The adapter uses exact analytics event identities within the active player bar and reads title/artist from separate UI elements. Unknown or ambiguous states still fail closed.

Cross-process operations are excluded using a Windows named pipe lease, released after each tool operation. Process termination also releases the OS-owned pipe, avoiding stale lock files. The pipe accepts no commands or account data.

Automated shutdown tests cover transport closure with queued operations, permanent adapter closure, and standard-input EOF. Shutdown prevents new actions and reconnection; it cannot undo an action already sent to the client.

No live account data, screenshots, song history or raw diagnostics are included in this repository. Synthetic fixtures exercise the corresponding structure with invented labels.

## 0.1.0-alpha.1

Initial implementation was verified using synthetic DOM fixtures and MCP/transport tests only. Its four-button layout assumption did not support the tested 3.1.39 default player; use alpha.2 or later for that layout.
