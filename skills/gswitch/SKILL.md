---
name: gswitch
description: Google account switcher for Antigravity CLI. Helps you store multiple Google accounts and easily switch between them when an account hits quota limits.
---

# Antigravity Google Account Switcher (`gswitch`)

This skill allows the Antigravity Agent and the user to manage multiple Google accounts on the Antigravity CLI (`agy`) and related editors. When an account runs out of Vertex AI API quota, you can easily swap to another saved account to continue your work without interruption.

## Available Tools

1. **`glist`**
   - **Description**: Lists all Google accounts stored in your profiles and indicates which one is currently active (`★ [ACTIVE]`).
   - **When to use**: Use this to check the list of available profiles and verify the currently active account.

2. **`gadd`**
   - **Description**: A stateful, 2-phase tool to register a new account:
     - **Phase 1 (Preparation)**: Automatically backs up the current session files and clears active tokens. Subsequent CLI calls or queries will prompt the browser Google OAuth sign-in flow.
     - **Phase 2 (Confirmation / Auto-Restore)**: Scans for the newly created active token, resolves its email, and saves it as a profile. If no new login is detected (e.g. login failed or cancelled), it **automatically restores** the previous active session to prevent lockout.
   - **When to use**: Run this when you want to add a new Google account to the switcher.

3. **`gset`**
   - **Description**: Switches the active Google account of the Antigravity CLI and IDE to a saved profile by its email.
   - **Arguments**:
     - `email` (string, required): The email address of the target account.
   - **When to use**: When the current account hits quota limits, execute this tool to swap to a secondary profile.

4. **`grm`**
   - **Description**: Deletes a saved profile from the switcher.
   - **Arguments**:
     - `email` (string, required): The email address of the profile to remove.

## Account Addition Workflow

To add a new Google account, follow these steps:
1. Run `gadd` once. The tool will auto-save your current active account and clear active tokens.
2. Submit a new prompt or run `agy` in your terminal to trigger the Google Sign-In browser flow. Complete the authentication.
3. Run `gadd` a second time to detect and save the new account as a profile.
*(If you cancel or fail the browser login, running `gadd` at step 3 will automatically restore your original active session).*
