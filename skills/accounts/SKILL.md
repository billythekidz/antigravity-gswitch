---
name: accounts
description: Google account switcher for Antigravity CLI. Helps you store multiple Google accounts and easily switch between them when an account hits quota limits.
---

# Antigravity Google Account Switcher (`accounts`)

This skill allows the Antigravity Agent and the user to manage multiple Google accounts on the Antigravity CLI (`agy`) and related editors. When an account runs out of Vertex AI API quota, you can easily swap to another saved account to continue your work without interruption.

## Available Tools

1. **`list`**
   - **Description**: Lists all Google accounts stored in your profiles and indicates which one is currently active (`★ [ACTIVE]`).
   - **When to use**: Use this to check the list of available profiles and verify the currently active account.

2. **`add`**
   - **Description**: Starts a temporary local redirect server and opens the browser Google Sign-in page. The plugin automatically saves and activates the authenticated profile in one go.
   - **When to use**: Run this when you want to add a new Google account to the switcher.

3. **`set`**
   - **Description**: Switches the active Google account of the Antigravity CLI and IDE to a saved profile by its email.
   - **Arguments**:
     - `email` (string, required): The email address of the target account.
   - **When to use**: When the current account hits quota limits, execute this tool to swap to a secondary profile.

4. **`remove`**
   - **Description**: Deletes a saved profile from the switcher.
   - **Arguments**:
     - `email` (string, required): The email address of the profile to remove.

## Account Addition Workflow

To add a new Google account:
1. Run the `add` tool.
2. Complete the Google Sign-in flow in the browser window that opens automatically (or click the returned link).
3. The background redirect server will automatically receive the callback, save the new profile, and set it as active.
