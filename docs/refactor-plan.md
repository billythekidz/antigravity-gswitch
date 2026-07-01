# agy-accounts Refactor Plan

## Context

`agy-accounts` works around a real Antigravity CLI pain point: OAuth sessions can fail to persist or become hard to switch when users rely on multiple Google accounts. The plugin is useful, but the current implementation keeps OAuth, profile storage, active-session mutation, CLI mode, and MCP JSON-RPC handling in one large `index.js` file. That makes callback bugs and partial token writes harder to reason about.

Google Antigravity CLI treats plugins and skills as first-class extension mechanisms, so the plugin should be shaped like a durable integration rather than a one-off session patcher.

## Goals

- Make OAuth callback handling reliable across localhost and IPv4/IPv6 differences.
- Avoid saving incomplete account profiles, especially profiles without refresh tokens.
- Make account switching transactional enough that active sessions do not become half-updated.
- Improve diagnostics for common Antigravity OAuth/session failures.
- Split the implementation into small modules that can be tested without launching a real browser OAuth flow.

## Proposed Architecture

### `src/oauth.js`

Responsibilities:

- Build the Google OAuth authorization URL.
- Generate and validate OAuth `state`.
- Exchange authorization codes for tokens.
- Refresh access tokens.
- Resolve the authenticated email from `id_token` or Google userinfo.

### `src/profileStore.js`

Responsibilities:

- List saved profiles.
- Read and write profile token files.
- Validate required profile fields.
- Use atomic writes to avoid corrupt profile files.

### `src/antigravitySession.js`

Responsibilities:

- Read the current active Antigravity session.
- Save the current active session into a matching profile.
- Switch the active session to a saved profile.
- Update `google_accounts.json`.
- Create timestamped backups before mutating active credentials.

### `src/mcpServer.js`

Responsibilities:

- Own JSON-RPC/MCP protocol handling.
- Register the `list`, `add`, `set`, `remove`, and future `doctor` tools.
- Convert internal errors into clear MCP responses.

### `src/cli.js`

Responsibilities:

- Provide standalone commands for fresh-session bootstrap.
- Reuse the same handlers as the MCP server.
- Keep CLI exit behavior separate from library code.

### `index.js`

Responsibilities:

- Minimal entrypoint only.
- Dispatch to CLI mode when arguments are provided.
- Start the MCP server when running over stdio.

## Reliability Improvements

### OAuth Callback

- Use a single redirect host consistently between server bind, auth URL, and token exchange.
- Prefer `127.0.0.1` for IPv4 reliability, with a fallback strategy if needed.
- Add OAuth `state` to prevent stale or unrelated callbacks from saving tokens.
- Show success in the browser only after token exchange and file writes complete.
- Show a clear browser error page if token exchange or save fails.

### Refresh Token Handling

- Request `access_type=offline`.
- Use `prompt=select_account consent` when adding a new account.
- Reject new profiles if Google does not return a `refresh_token`.
- Document that users may need to revoke prior consent and retry if Google withholds a refresh token.

### Session Writes

- Write token files atomically using temp files and rename.
- Backup active session files before switching accounts.
- Roll back active session files if a switch fails halfway.
- Keep profile files and active session files schema-compatible with Antigravity CLI expectations.

### Diagnostics

Add a `doctor` command/tool that reports:

- Whether expected Antigravity paths exist.
- Whether active token files parse as JSON.
- Whether active email can be resolved.
- Whether `google_accounts.json.active` matches the resolved active email.
- Which profiles are missing token files or refresh tokens.
- Where to find the debug log.

## Documentation Improvements

- Explain that `agy plugin install` stages a copy of the plugin, so local repo changes require reinstalling or copying into the installed plugin path.
- Add a troubleshooting section for callback timeout, missing refresh token, stale installed plugin code, and malformed token files.
- Document the debug log path: `~/.gemini/antigravity-cli/accounts-mcp.log`.
- Add examples for both MCP usage inside `agy` and standalone CLI bootstrap mode.

## Suggested Delivery Order

1. Harden OAuth state, redirect host, and refresh-token checks.
2. Add atomic writes and backup/rollback for active session mutation.
3. Extract storage and OAuth modules.
4. Add `doctor`.
5. Add focused tests for storage, session switching, and URL/token-shape logic.
6. Refresh README and skill instructions to match the new commands and failure modes.
