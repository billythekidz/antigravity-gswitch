# agy-accounts Refactor Tasks

## Phase 1: OAuth Safety

- [ ] Add OAuth `state` generation and validation.
- [ ] Store pending OAuth state in memory for the active `add` flow.
- [ ] Reject callbacks with missing or mismatched `state`.
- [ ] Keep redirect host, auth URL, and token exchange redirect URI derived from one constant/config value.
- [ ] Keep success page delayed until after token exchange and file save.
- [ ] Return an error page when token exchange, email resolution, or file save fails.
- [ ] Require `refresh_token` before saving a new profile.
- [ ] Keep `access_type=offline` and `prompt=select_account consent` in the auth URL.

## Phase 2: Safer File Writes

- [ ] Add an `atomicWriteJson(filePath, data)` helper.
- [ ] Use temp-file then rename semantics for profile writes.
- [ ] Use temp-file then rename semantics for active session writes.
- [ ] Ensure parent directories are created before writes.
- [ ] Add timestamped backup directories before switching accounts.
- [ ] Roll back active files if switching fails after any active file has been changed.
- [ ] Avoid deleting existing credentials until replacement files are verified.

## Phase 3: Module Extraction

- [ ] Create `src/oauth.js`.
- [ ] Move auth URL creation into `src/oauth.js`.
- [ ] Move code exchange into `src/oauth.js`.
- [ ] Move token refresh into `src/oauth.js`.
- [ ] Move email resolution helpers into `src/oauth.js`.
- [ ] Create `src/profileStore.js`.
- [ ] Move profile listing, reading, writing, and validation into `src/profileStore.js`.
- [ ] Create `src/antigravitySession.js`.
- [ ] Move active session read, save, switch, and account metadata updates into `src/antigravitySession.js`.
- [ ] Create `src/mcpServer.js`.
- [ ] Move JSON-RPC/MCP request handling into `src/mcpServer.js`.
- [ ] Create `src/cli.js`.
- [ ] Move command-line parsing and exit behavior into `src/cli.js`.
- [ ] Reduce `index.js` to entrypoint wiring.

## Phase 4: Doctor Command

- [ ] Add `doctor` to CLI commands.
- [ ] Add `doctor` to MCP tools list.
- [ ] Check that `~/.gemini/antigravity-cli` exists or can be created.
- [ ] Check that active token file exists and parses.
- [ ] Check that active creds file exists and parses when present.
- [ ] Resolve active email when possible.
- [ ] Check `google_accounts.json` parse status.
- [ ] Compare `google_accounts.json.active` with resolved active email.
- [ ] List profiles missing `antigravity-oauth-token`.
- [ ] List profiles missing `oauth_creds.json`.
- [ ] List profiles missing `refresh_token`.
- [ ] Print debug log location.

## Phase 5: Tests

- [ ] Add Node built-in test runner setup.
- [ ] Test auth URL includes redirect URI, scopes, offline access, prompt, and state.
- [ ] Test email decode from `id_token`.
- [ ] Test profile validation rejects missing refresh token.
- [ ] Test profile list ignores non-directories.
- [ ] Test session switch updates active files and `google_accounts.json`.
- [ ] Test switch rollback on simulated write failure.
- [ ] Test `doctor` reports malformed JSON without throwing.

## Phase 6: Documentation

- [ ] Update README installation notes for staged plugin copies.
- [ ] Add local development workflow.
- [ ] Add troubleshooting for callback timeout.
- [ ] Add troubleshooting for missing refresh token.
- [ ] Add troubleshooting for stale installed plugin code.
- [ ] Add troubleshooting for malformed token/profile files.
- [ ] Document `doctor`.
- [ ] Update `skills/accounts/SKILL.md` with the `doctor` command.
- [ ] Add a short security note about local token storage.

## Phase 7: Release Prep

- [ ] Bump plugin version.
- [ ] Run syntax checks.
- [ ] Run tests.
- [ ] Test standalone `node index.js list`.
- [ ] Test standalone `node index.js doctor`.
- [ ] Reinstall plugin locally with `agy plugin install /path/to/local/plugin`.
- [ ] Smoke test `list`, `add`, `set`, and `remove` inside `agy`.
- [ ] Update changelog or release notes.
