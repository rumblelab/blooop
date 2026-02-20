'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const semver = require('semver');

// User preferences (sound path, etc.) stay in the main config.
// Update cache lives in a separate file so the two never race each other.
const CACHE_PATH = path.join(os.homedir(), '.blooop-cache.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch (_) { return {}; }
}

function saveCache(data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmp = CACHE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, CACHE_PATH);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_2) {}
  }
}

function fetchLatestVersion(callback) {
  const req = https.get(
    'https://registry.npmjs.org/blooop/latest',
    { timeout: 5000 },
    (res) => {
      if (res.statusCode !== 200) { res.resume(); callback(null); return; }
      let data = '';
      res.on('data', chunk => {
        if (data.length + chunk.length > 65536) { res.destroy(); callback(null); return; }
        data += chunk;
      });
      res.on('end', () => {
        try { callback(JSON.parse(data).version || null); } catch (_) { callback(null); }
      });
    }
  );
  req.on('error', () => callback(null));
  req.on('timeout', () => { req.destroy(); callback(null); });
  if (typeof req.unref === 'function') req.unref();
}

/**
 * Show an update notice if a newer version is cached, then kick off a background
 * refresh of the cache. Call this before spawning the PTY so output is clean.
 *
 * @param {string} currentVersion  e.g. require('../package.json').version
 */
function checkForUpdate(currentVersion) {
  const cache = loadCache();
  const now = Date.now();

  // Show notice based on previously cached data (no network wait).
  if (cache.latest && semver.valid(cache.latest) && semver.gt(cache.latest, currentVersion)) {
    process.stdout.write(
      `\x1b[33mblooop ${cache.latest} is available\x1b[0m (you have ${currentVersion})\r\n` +
      `\x1b[2mRun: npm install -g blooop\x1b[0m\r\n\r\n`
    );
  }

  // Background refresh if cache is stale.
  if (!cache.checkedAt || now - cache.checkedAt > CHECK_INTERVAL_MS) {
    fetchLatestVersion((latest) => {
      if (!latest || !semver.valid(latest)) return;
      saveCache({ latest, checkedAt: now });
    });
  }
}

module.exports = { checkForUpdate };
