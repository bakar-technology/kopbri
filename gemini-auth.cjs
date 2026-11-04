'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const core = await import(pathToFileURL(process.argv[2]).href);
  if (typeof core.getOauthClient !== 'function') throw new Error('Gemini authentication API is unavailable in this CLI version.');
  if (process.argv[3] === 'inspect') { console.log(JSON.stringify({ ready: true, oauth: true })); return; }
  if (process.argv[3] === 'logout') { await core.clearCachedCredentialFile(); return; }
  core.coreEvents.on(core.CoreEvent.UserFeedback, event => {
    // The host only needs the authorization URL and progress, never tokens.
    if (event.message) process.stdout.write(String(event.message) + '\n');
  });
  // The user explicitly requested connection in the host UI; provider consent remains in Google’s browser page.
  await core.getOauthClient(core.AuthType.LOGIN_WITH_GOOGLE, {
    getProxy: () => undefined, isBrowserLaunchSuppressed: () => false,
    isInteractive: () => false, getAcpMode: () => true,
  });
  const dir = path.join(process.env.GEMINI_CLI_HOME, '.gemini');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  let settings = {}; try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  settings.security = { ...settings.security, auth: { ...settings.security?.auth, selectedType: 'oauth-personal' } };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  console.log('Signed in.');
})().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
