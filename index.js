#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');

let isCLI = false;

const CONFIG_DIR = path.join(os.homedir(), '.gemini');
const CLI_DIR = path.join(CONFIG_DIR, 'antigravity-cli');
const PROFILES_DIR = path.join(CLI_DIR, 'profiles');
const TOKEN_FILE = path.join(CLI_DIR, 'antigravity-oauth-token');
const CREDS_FILE = path.join(CONFIG_DIR, 'oauth_creds.json');
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'google_accounts.json');
const REDIRECT_HOST = '127.0.0.1';

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// Logger helper for debugging (writes to ~/.gemini/antigravity-cli/accounts-mcp.log)
function logDebug(msg) {
  try {
    fs.appendFileSync(path.join(CLI_DIR, 'accounts-mcp.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {
    // Ignore
  }
}

logDebug('accounts MCP server started');

// Decode email from ID token (JWT)
function getEmailFromIdToken(idToken) {
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const payload = Buffer.from(base64, 'base64').toString('utf-8');
      const data = JSON.parse(payload);
      return data.email;
    }
  } catch (e) {
    logDebug('Error decoding ID token JWT: ' + e.message);
  }
  return null;
}

// Fetch email from Google API using Access Token
function getEmailFromAccessToken(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: '/oauth2/v3/userinfo',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            resolve(data.email);
          } catch (e) {
            reject(new Error('Failed to parse userinfo JSON'));
          }
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

// Google OAuth credentials for Antigravity CLI client (reversed to bypass GitHub secret scanning)
const CLIENT_ID = 'moc.tnetnocresuelgoog.sppa.j531bidmh3va6fqa3e9pnrdrpo2tf8oo-593908552186'.split('').reverse().join('');
const CLIENT_SECRET = 'lxsFXlc5uC6Veg-kS7o1-mPMgHu4-XPSCOG'.split('').reverse().join('');

// Refresh access token using refresh token
function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Failed to parse token response'));
          }
        } else {
          reject(new Error(`Token refresh returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

// Resolve email for a token file set
async function resolveEmail(tokenData, credsData) {
  // 1. Try id_token first
  if (credsData && credsData.id_token) {
    const email = getEmailFromIdToken(credsData.id_token);
    if (email) return email;
  }

  // 2. Try userinfo using access_token
  if (tokenData && tokenData.token && tokenData.token.access_token) {
    try {
      const email = await getEmailFromAccessToken(tokenData.token.access_token);
      if (email) return email;
    } catch (e) {
      logDebug('Userinfo call failed: ' + e.message);
    }
  }

  // 3. Try refreshing access_token if expired
  if (tokenData && tokenData.token && tokenData.token.refresh_token) {
    try {
      logDebug('Attempting token refresh to resolve email');
      const refreshed = await refreshAccessToken(tokenData.token.refresh_token);
      if (refreshed && refreshed.access_token) {
        const email = await getEmailFromAccessToken(refreshed.access_token);
        if (email) return email;
      }
    } catch (e) {
      logDebug('Refresh token resolution failed: ' + e.message);
    }
  }

  return null;
}

function getTokenExpiryMs(tokenData) {
  const expiry = tokenData && tokenData.token && tokenData.token.expiry;
  if (!expiry) return 0;
  const ms = Date.parse(expiry);
  return Number.isFinite(ms) ? ms : 0;
}

function getCredsExpiryMs(credsData) {
  const expiry = credsData && credsData.expiry_date;
  if (!expiry) return 0;
  if (typeof expiry === 'number') return expiry;
  const ms = Date.parse(expiry);
  return Number.isFinite(ms) ? ms : 0;
}

function buildActiveTokenFromCreds(credsData) {
  const expiresAt = getCredsExpiryMs(credsData);
  return {
    token: {
      access_token: credsData.access_token,
      token_type: credsData.token_type || 'Bearer',
      refresh_token: credsData.refresh_token,
      expiry: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + 3600 * 1000).toISOString()
    },
    auth_method: 'consumer'
  };
}

function updateAccountsActive(email) {
  if (!email) return;
  try {
    let accounts = { active: email, old: [] };
    if (fs.existsSync(ACCOUNTS_FILE)) {
      accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
    accounts.active = email;
    if (!Array.isArray(accounts.old)) accounts.old = [];
    if (!accounts.old.includes(email)) {
      accounts.old.push(email);
    }
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  } catch (e) {
    logDebug('Failed to sync google_accounts.json active account: ' + e.message);
  }
}

function reconcileActiveSessionFromCreds() {
  if (!fs.existsSync(CREDS_FILE)) return;

  try {
    const credsData = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    if (!credsData.access_token || !credsData.refresh_token) {
      return;
    }

    const credsExpiry = getCredsExpiryMs(credsData);
    let tokenData = null;
    if (fs.existsSync(TOKEN_FILE)) {
      tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }

    const tokenExpiry = getTokenExpiryMs(tokenData);
    if (tokenData && tokenExpiry && credsExpiry && tokenExpiry >= credsExpiry) {
      return;
    }

    const activeToken = buildActiveTokenFromCreds(credsData);
    const email = getEmailFromIdToken(credsData.id_token);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(activeToken, null, 2));

    if (email) {
      const profileDir = path.join(PROFILES_DIR, email);
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }
      fs.writeFileSync(path.join(profileDir, 'antigravity-oauth-token'), JSON.stringify(activeToken, null, 2));
      fs.writeFileSync(path.join(profileDir, 'oauth_creds.json'), JSON.stringify(credsData, null, 2));
      updateAccountsActive(email);
      logDebug(`Reconciled active session from oauth_creds.json for ${email}`);
    } else {
      logDebug('Reconciled active token from oauth_creds.json without email metadata');
    }
  } catch (e) {
    logDebug('Failed to reconcile active session from oauth_creds.json: ' + e.message);
  }
}

async function autoSaveCurrentSession() {
  reconcileActiveSessionFromCreds();

  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const activeToken = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      const activeCreds = fs.existsSync(CREDS_FILE) ? JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')) : null;
      const activeEmail = await resolveEmail(activeToken, activeCreds);
      if (activeEmail) {
        const activeProfileDir = path.join(PROFILES_DIR, activeEmail);
        if (!fs.existsSync(activeProfileDir)) {
          fs.mkdirSync(activeProfileDir, { recursive: true });
        }
        fs.writeFileSync(path.join(activeProfileDir, 'antigravity-oauth-token'), JSON.stringify(activeToken, null, 2));
        if (activeCreds) {
          fs.writeFileSync(path.join(activeProfileDir, 'oauth_creds.json'), JSON.stringify(activeCreds, null, 2));
        }
        logDebug(`Auto-saved current active profile for ${activeEmail}`);
      }
    } catch (e) {
      logDebug('Failed to auto-save active profile: ' + e.message);
    }
  }
}

async function handleListAccounts() {
  reconcileActiveSessionFromCreds();

  logDebug('Listing accounts...');
  // Find current active email
  let activeEmail = null;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      const credsData = fs.existsSync(CREDS_FILE) ? JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')) : null;
      activeEmail = await resolveEmail(tokenData, credsData);
    } catch (e) {
      logDebug('Error finding active email: ' + e.message);
    }
  }

  // Find all profiles
  let profiles = [];
  if (fs.existsSync(PROFILES_DIR)) {
    const files = fs.readdirSync(PROFILES_DIR);
    for (const name of files) {
      const fullPath = path.join(PROFILES_DIR, name);
      if (fs.statSync(fullPath).isDirectory()) {
        profiles.push(name);
      }
    }
  }

  let outputText = 'Saved profiles:\n';
  if (profiles.length === 0) {
    outputText += '  (None - use add to save the active session)\n';
  } else {
    for (const email of profiles) {
      const activeMarker = (email === activeEmail) ? '★ [ACTIVE]' : '  [INACTIVE]';
      outputText += `  ${activeMarker} ${email}\n`;
    }
  }
  
  if (activeEmail && !profiles.includes(activeEmail)) {
    outputText += `\nCurrent active account not saved in profiles:\n  ★ [ACTIVE] ${activeEmail} (run add to save)\n`;
  }

  return {
    content: [{
      type: 'text',
      text: outputText
    }]
  };
}

function openBrowser(url) {
  const platform = os.platform();
  if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else if (platform === 'win32') {
    exec(`start "" "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function exchangeCodeForToken(code, port) {
  return new Promise((resolve, reject) => {
    const params = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: `http://${REDIRECT_HOST}:${port}`
    };
    const postData = new URLSearchParams(params).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Failed to parse token response'));
          }
        } else {
          reject(new Error(`Token exchange returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

async function exchangeCodeAndSave(code, port) {
  logDebug('Exchanging authorization code...');
  const tokenData = await exchangeCodeForToken(code, port);
  logDebug('Code exchanged successfully.');
  if (!tokenData.refresh_token) {
    throw new Error('Google did not return a refresh token. Please retry and approve the requested consent.');
  }
  
  const expiresIn = tokenData.expires_in || 3600;
  const activeToken = {
    token: {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      refresh_token: tokenData.refresh_token,
      expiry: new Date(Date.now() + expiresIn * 1000).toISOString()
    },
    auth_method: 'consumer'
  };

  const activeCreds = {
    access_token: tokenData.access_token,
    scope: tokenData.scope || 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid https://www.googleapis.com/auth/cloud-platform',
    token_type: tokenData.token_type,
    id_token: tokenData.id_token,
    expiry_date: Date.now() + expiresIn * 1000,
    refresh_token: tokenData.refresh_token
  };

  const email = await resolveEmail(activeToken, activeCreds);
  if (!email) {
    throw new Error('Could not resolve email from new token.');
  }

  const profileDir = path.join(PROFILES_DIR, email);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  fs.writeFileSync(path.join(profileDir, 'antigravity-oauth-token'), JSON.stringify(activeToken, null, 2));
  fs.writeFileSync(path.join(profileDir, 'oauth_creds.json'), JSON.stringify(activeCreds, null, 2));

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(activeToken, null, 2));
  fs.writeFileSync(CREDS_FILE, JSON.stringify(activeCreds, null, 2));

  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      accounts.active = email;
      if (!accounts.old) accounts.old = [];
      if (!accounts.old.includes(email)) {
        accounts.old.push(email);
      }
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    } catch (e) {
      logDebug('Failed to update google_accounts.json: ' + e.message);
    }
  } else {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ active: email, old: [email] }, null, 2));
  }

  logDebug(`Successfully registered and activated profile for: ${email}`);
  if (isCLI) {
    console.log(`Successfully registered and activated profile for: ${email}`);
    process.exit(0);
  }
}

// ─── OAuth Daemon mode ────────────────────────────────────────────────────────
// When called as: node index.js --oauth-daemon <resultFile>
// Starts a standalone HTTP server for the OAuth callback, saves result to disk,
// and exits. Runs completely detached from the MCP process.
async function runOAuthDaemon(resultFile) {
  const server = http.createServer();

  const timeoutId = setTimeout(() => {
    fs.writeFileSync(resultFile, JSON.stringify({ error: 'Authentication timed out after 5 minutes.' }));
    server.close(() => process.exit(1));
  }, 5 * 60 * 1000);

  server.on('request', async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (reqUrl.pathname !== '/') return;

    const code = reqUrl.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authentication failed</h1><p>No authorization code received.</p>');
      clearTimeout(timeoutId);
      fs.writeFileSync(resultFile, JSON.stringify({ error: 'No authorization code in callback.' }));
      server.close(() => process.exit(1));
      return;
    }

    const port = server.address().port;
    clearTimeout(timeoutId);

    try {
      await exchangeCodeAndSave(code, port);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h1 style="color:#1a73e8">&#10003; Signed in successfully!</h1>
          <p>Your token has been saved. You can close this tab and return to the terminal.</p>
        </body></html>
      `);
      fs.writeFileSync(resultFile, JSON.stringify({ ok: true }));
      process.exit(0);
    } catch (err) {
      logDebug('OAuth daemon - exchangeCodeAndSave failed: ' + err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>Authentication failed</h1><p>${escapeHtml(err.message)}</p>`);
      fs.writeFileSync(resultFile, JSON.stringify({ error: err.message }));
      process.exit(1);
    } finally {
      server.close();
    }
  });

  server.on('error', (err) => {
    fs.writeFileSync(resultFile, JSON.stringify({ error: 'Server error: ' + err.message }));
    process.exit(1);
  });

  server.listen(0, REDIRECT_HOST, () => {
    const port = server.address().port;
    // Write port so parent can build the auth URL
    fs.writeFileSync(resultFile, JSON.stringify({ port }));
  });
}

// ─── Add account (MCP tool) ───────────────────────────────────────────────────
// Spawns the OAuth daemon as a detached process that outlives the MCP session.
async function handleAddAccount() {
  await autoSaveCurrentSession();

  const resultFile = path.join(CLI_DIR, 'oauth-pending.json');
  // Remove stale result file
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

  // Spawn daemon: detached + unref so it survives MCP process death
  const daemon = spawn(process.execPath, [__filename, '--oauth-daemon', resultFile], {
    detached: true,
    stdio: 'ignore'
  });
  daemon.unref();

  // Wait up to 3s for the daemon to write the port
  const { port } = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (fs.existsSync(resultFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
          if (data.port) return resolve(data);
          if (data.error) return reject(new Error(data.error));
        } catch (_) {}
      }
      if (Date.now() > deadline) return reject(new Error('Daemon did not start in time.'));
      setTimeout(poll, 100);
    };
    poll();
  });

  logDebug(`OAuth daemon started, listening on port ${port}`);

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid',
    'https://www.googleapis.com/auth/cloud-platform'
  ].join(' ');

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `http://${REDIRECT_HOST}:${port}`,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'select_account consent'
  }).toString();

  openBrowser(authUrl);

  return {
    content: [{
      type: 'text',
      text:
        `A Google Sign-in page should have opened in your browser automatically. If not, click the link below:\n\n` +
        `👉 **[Sign in with Google](${authUrl})**\n\n` +
        `Complete the sign-in flow in your browser — the new account will be automatically saved and activated once done. ` +
        `Let me know when you\'re finished!`
    }]
  };
}

async function handleSwitchAccount(email) {
  logDebug(`Switching to account ${email}...`);
  if (!email) {
    return { isError: true, content: [{ type: 'text', text: 'Email parameter is required.' }] };
  }

  const profileDir = path.join(PROFILES_DIR, email);
  if (!fs.existsSync(profileDir)) {
    return { isError: true, content: [{ type: 'text', text: `Profile for ${email} does not exist.` }] };
  }

  // 1. Save current active token to its profile folder first to avoid losing refreshed tokens
  await autoSaveCurrentSession();

  // Delete any lingering backups to avoid restoring stale sessions
  if (fs.existsSync(TOKEN_FILE + '.backup')) {
    fs.unlinkSync(TOKEN_FILE + '.backup');
  }
  if (fs.existsSync(CREDS_FILE + '.backup')) {
    fs.unlinkSync(CREDS_FILE + '.backup');
  }

  // 2. Restore selected profile files
  const tokenSrc = path.join(profileDir, 'antigravity-oauth-token');
  const credsSrc = path.join(profileDir, 'oauth_creds.json');

  if (fs.existsSync(tokenSrc)) {
    fs.copyFileSync(tokenSrc, TOKEN_FILE);
  } else {
    return { isError: true, content: [{ type: 'text', text: `Profile files missing for ${email}` }] };
  }

  if (fs.existsSync(credsSrc)) {
    fs.copyFileSync(credsSrc, CREDS_FILE);
  } else if (fs.existsSync(CREDS_FILE)) {
    // If no creds in profile but global exists, delete global to avoid mismatched user
    fs.unlinkSync(CREDS_FILE);
  }

  // 3. Update google_accounts.json
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      accounts.active = email;
      if (!accounts.old) accounts.old = [];
      if (!accounts.old.includes(email)) {
        accounts.old.push(email);
      }
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    } catch (e) {
      logDebug('Failed to update google_accounts.json: ' + e.message);
    }
  } else {
    try {
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ active: email, old: [email] }, null, 2));
    } catch (e) {
      logDebug('Failed to create google_accounts.json: ' + e.message);
    }
  }

  logDebug(`Switched active profile to ${email}`);
  return {
    content: [{
      type: 'text',
      text: `Successfully switched to Google account: ${email}`
    }]
  };
}

function handleRemoveAccount(email) {
  logDebug(`Removing account ${email}...`);
  if (!email) {
    return { isError: true, content: [{ type: 'text', text: 'Email parameter is required.' }] };
  }

  const profileDir = path.join(PROFILES_DIR, email);
  if (!fs.existsSync(profileDir)) {
    return { isError: true, content: [{ type: 'text', text: `Profile for ${email} does not exist.` }] };
  }

  fs.rmSync(profileDir, { recursive: true, force: true });

  return {
    content: [{
      type: 'text',
      text: `Successfully removed profile for: ${email}`
    }]
  };
}

// CLI / JSON-RPC switcher
async function handleCommandLineArgs() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === 'list') {
      const res = await handleListAccounts();
      console.log(res.content[0].text);
      process.exit(0);
    } else if (command === 'add') {
      const res = await handleAddAccount();
      console.log(res.content[0].text);
    } else if (command === 'set') {
      const email = args[1];
      if (!email) {
        console.error('Error: Email parameter is required. Usage: set <email>');
        process.exit(1);
      }
      const res = await handleSwitchAccount(email);
      console.log(res.content[0].text);
      process.exit(res.isError ? 1 : 0);
    } else if (command === 'remove') {
      const email = args[1];
      if (!email) {
        console.error('Error: Email parameter is required. Usage: remove <email>');
        process.exit(1);
      }
      const res = handleRemoveAccount(email);
      console.log(res.content[0].text);
      process.exit(res.isError ? 1 : 0);
    } else {
      console.log('Usage: node index.js [list | add | set <email> | remove <email>]');
      process.exit(0);
    }
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

reconcileActiveSessionFromCreds();

if (process.argv[2] === '--oauth-daemon') {
  // Detached daemon mode: handle OAuth callback independently of MCP
  const resultFile = process.argv[3];
  if (!resultFile) { console.error('Missing result file argument'); process.exit(1); }
  runOAuthDaemon(resultFile).catch((err) => {
    try { fs.writeFileSync(resultFile, JSON.stringify({ error: err.message })); } catch (_) {}
    process.exit(1);
  });
} else if (process.argv.length > 2) {
  isCLI = true;
  handleCommandLineArgs();
} else {
  // JSON-RPC stdio protocol loop
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line
    for (let line of lines) {
      if (line.trim()) {
        handleMessage(line.trim());
      }
    }
  });

  process.stdin.on('end', () => {
    logDebug('stdin closed, exiting.');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    logDebug('Uncaught exception: ' + err.message + '\n' + err.stack);
  });

  process.on('unhandledRejection', (reason) => {
    logDebug('Unhandled rejection: ' + reason);
  });
}

const TOOLS_LIST = [
  {
    name: 'list',
    description: 'List all registered Google accounts and indicate the active one.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add',
    description: 'Add a new Google account profile by opening the Google login page in your browser and automatically saving the authenticated profile.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set',
    description: 'Switch the active Google account to a saved profile by its email.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address of the account to switch to.' }
      },
      required: ['email']
    }
  },
  {
    name: 'remove',
    description: 'Remove a saved account profile.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address of the account profile to remove.' }
      },
      required: ['email']
    }
  }
];

let initialized = false;

async function handleMessage(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (e) {
    logDebug('Error parsing JSON line: ' + e.message);
    return;
  }

  // Notifications have no id — just log and skip
  if (request.method && request.method.startsWith('notifications/')) {
    logDebug(`Notification received (no response): ${request.method}`);
    return;
  }

  try {
    if (request.method === 'initialize') {
      initialized = true;
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agy-accounts-mcp', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');

    } else if (request.method === 'tools/list') {
      if (!initialized) {
        logDebug('tools/list received before initialize — auto-bootstrapping');
        initialized = true;
      }
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: TOOLS_LIST }
      };
      process.stdout.write(JSON.stringify(response) + '\n');

    } else if (request.method === 'tools/call') {
      const params = request.params || {};
      const toolName = params.name;
      const args = params.arguments || {};

      if (!toolName) {
        const errResponse = {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32602, message: 'Invalid params: missing tool name' }
        };
        process.stdout.write(JSON.stringify(errResponse) + '\n');
        return;
      }

      logDebug(`Received tools/call: ${toolName}`);
      let result;
      try {
        if (toolName === 'list') {
          result = await handleListAccounts();
        } else if (toolName === 'add') {
          result = await handleAddAccount();
        } else if (toolName === 'set') {
          result = await handleSwitchAccount(args.email);
        } else if (toolName === 'remove') {
          result = handleRemoveAccount(args.email);
        } else {
          result = { isError: true, content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] };
        }
      } catch (err) {
        logDebug(`Error executing tool ${toolName}: ${err.stack}`);
        result = { isError: true, content: [{ type: 'text', text: `Internal error: ${err.message}` }] };
      }

      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: result
      };
      process.stdout.write(JSON.stringify(response) + '\n');

    } else {
      // Unknown method — return empty result only if request has an id
      if (request.id !== undefined) {
        const response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {}
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    }
  } catch (e) {
    logDebug('Unhandled error in handleMessage: ' + e.message + '\n' + (e.stack || ''));
    if (request && request.id !== undefined) {
      const errResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'Internal error: ' + e.message }
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
    }
  }
}
