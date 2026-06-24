#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), '.gemini');
const CLI_DIR = path.join(CONFIG_DIR, 'antigravity-cli');
const PROFILES_DIR = path.join(CLI_DIR, 'profiles');
const TOKEN_FILE = path.join(CLI_DIR, 'antigravity-oauth-token');
const CREDS_FILE = path.join(CONFIG_DIR, 'oauth_creds.json');
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'google_accounts.json');

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

// Google OAuth Client ID for Antigravity CLI client
const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

// Refresh access token using refresh token
function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: CLIENT_ID,
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

async function autoSaveCurrentSession() {
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

function exchangeCodeForToken(code, port) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: CLIENT_ID,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: `http://localhost:${port}`
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
}

async function handleAddAccount() {
  await autoSaveCurrentSession();

  return new Promise((resolve) => {
    logDebug('handleAddAccount: Starting local OAuth redirect server...');
    const server = http.createServer();
    
    // Set a timeout to close the server if authentication takes too long (5 minutes)
    const timeoutId = setTimeout(() => {
      logDebug('OAuth server timeout reached. Closing server.');
      server.close();
    }, 5 * 60 * 1000);

    server.on('request', async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname === '/') {
        const code = reqUrl.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Authentication successful!</h1><p>You can close this tab and return to the terminal/IDE.</p>');
          
          const port = server.address().port;
          clearTimeout(timeoutId);
          server.close();
          
          try {
            await exchangeCodeAndSave(code, port);
          } catch (err) {
            logDebug('Error exchanging code: ' + err.message);
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Authentication failed</h1><p>No authorization code found in request.</p>');
          
          clearTimeout(timeoutId);
          server.close();
        }
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      logDebug(`OAuth redirect server listening on port ${port}`);

      const scopes = [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
        'https://www.googleapis.com/auth/cloud-platform'
      ].join(' ');

      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: `http://localhost:${port}`,
        response_type: 'code',
        scope: scopes,
        prompt: 'select_account'
      }).toString();

      openBrowser(authUrl);

      resolve({
        content: [{
          type: 'text',
          text: `Please authenticate in your browser.\n\n` +
                `If it did not open automatically, click the link below:\n` +
                `[Google Authentication Link](${authUrl})\n\n` +
                `The local server is waiting on http://localhost:${port} for the callback.`
        }]
      });
    });

    server.on('error', (err) => {
      logDebug('Server error: ' + err.message);
      clearTimeout(timeoutId);
      resolve({
        isError: true,
        content: [{
          type: 'text',
          text: 'Failed to start local redirect server: ' + err.message
        }]
      });
    });
  });
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

// JSON-RPC stdio protocol loop
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line
  for (let line of lines) {
    if (line.trim()) {
      handleMessage(line);
    }
  }
});

async function handleMessage(line) {
  try {
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'agy-accounts-mcp',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (request.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
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
          ]
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (request.method === 'tools/call') {
      const toolName = request.params.name;
      const args = request.params.arguments || {};
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
          result = { isError: true, content: [{ type: 'text', text: `Tool ${toolName} not found` }] };
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
      // Respond to other JSON-RPC requests with an empty result to prevent hangs
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {}
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (e) {
    logDebug('Error parsing line: ' + e.message);
  }
}
