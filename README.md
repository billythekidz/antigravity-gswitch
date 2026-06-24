# Antigravity Google Account Switcher (`agy-accounts`)

A public plugin for the **Google Antigravity CLI (`agy`)** designed to manage multiple Google account profiles and seamlessly swap between them when you encounter Vertex AI API quota limits.

## Features

- **Multi-Profile Storage**: Save tokens for multiple Google accounts locally.
- **Auto-Save Token Refreshes**: Before switching accounts, the plugin updates the saved credentials for the current account to preserve refreshed access tokens.
- **One-Click Add Account (`add`)**:
  - Automatically backs up your current active session first.
  - Starts a temporary local redirect server and opens the browser Google Sign-in page.
  - Automatically captures the redirected credentials, resolves the email, and saves/activates the new profile.
- **Fast Switch**: Swaps out active CLI tokens (`antigravity-oauth-token`), active credentials (`oauth_creds.json`), and system account configurations (`google_accounts.json`) instantly.
- **Zero Configuration**: Dynamically resolves home directory paths on startup. Works immediately after installation on macOS, Windows, and Linux without any manual settings or post-install scripts.
- **Zero Dependencies**: Pure Vanilla Node.js implementation for maximum security, compatibility, and startup performance.

## Files Structure

```
agy-accounts/
├── plugin.json          # Antigravity CLI plugin manifest
├── mcp_config.json      # Model Context Protocol configuration
├── index.js             # Stdio-based JSON-RPC MCP server
├── README.md
├── LICENSE
└── skills/
    └── accounts/
        └── SKILL.md     # Agent instructions (in English)
```

## Installation

Install the plugin directly from GitHub:
```bash
agy plugin install https://github.com/billythekidz/agy-accounts
```

Verify that the plugin is listed and loaded:
```bash
agy plugin list
```

## Bootstrap Mode (For Fresh Sessions)

If you are initializing a completely new machine/session and do not have any active Google credentials, you can use the plugin as a standalone CLI to bootstrap your login **before** starting `agy`:

```bash
node ~/.gemini/config/plugins/agy-accounts/index.js add
```

This will spin up the local redirect server, open your browser, and save the authenticated credentials as your active session and profile. Once completed, you can launch `agy` normally without any credential errors.

## Usage

You can invoke the switching commands from within the `agy` interactive terminal session:

### 1. Add Account
To add a new account, simply run:
```
add
```
This will:
1. Auto-save your current active session to its profile folder.
2. Spin up a temporary local redirect server.
3. Open your web browser to Google's authentication page.
4. Once you complete the login, the local server will receive the callback, exchange the code for credentials, and save/activate the new profile automatically.

### 2. List Accounts
Show all saved accounts and see which one is active:
```
list
```

### 3. Switch Account
Switch to another saved email:
```
set email="user2@gmail.com"
```

### 4. Remove Account
Remove a saved email profile:
```
remove email="user2@gmail.com"
```

## License

MIT License.
