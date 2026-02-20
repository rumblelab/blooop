#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const notifier = require('node-notifier');

const DEFAULT_SOUND_PATH = path.join(__dirname, '..', 'sounds', 'bloop.wav');
const CONFIG_PATH = path.join(os.homedir(), '.blooop.json');

const COOLDOWN_MS = 8000;
let lastNotifyAt = 0;
let soundProc = null;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

const AUDIO_EXTENSION_RE = /\.(wav|mp3|ogg|aiff?)$/i;

function getSoundPath(config) {
  if (config.sound && typeof config.sound === 'string' && AUDIO_EXTENSION_RE.test(config.sound)) {
    return path.resolve(config.sound);
  }
  return DEFAULT_SOUND_PATH;
}

function getPlayers(soundPath) {
  if (process.platform === 'darwin') {
    return [{ command: 'afplay', args: [soundPath] }];
  }

  if (process.platform === 'linux') {
    return [
      { command: 'paplay', args: [soundPath] },
      { command: 'aplay', args: [soundPath] },
    ];
  }

  if (process.platform === 'win32') {
    const escapedPath = soundPath.replace(/'/g, "''");
    const psCommand = `(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()`;
    return [
      { command: 'powershell', args: ['-NoProfile', '-Command', psCommand] },
      { command: 'pwsh', args: ['-NoProfile', '-Command', psCommand] },
    ];
  }

  return [];
}

function playWithFallback(players, idx) {
  if (idx >= players.length) return;

  const { command, args } = players[idx];
  const proc = spawn(command, args, { stdio: 'ignore' });
  soundProc = proc;

  // Guard against both error and exit firing for the same failure.
  let advanced = false;
  function tryNext() {
    if (advanced) return;
    advanced = true;
    if (soundProc === proc) soundProc = null;
    playWithFallback(players, idx + 1);
  }

  proc.once('error', (err) => {
    if (soundProc === proc) soundProc = null;
    // ENOENT: command not found — try the next player.
    if (err && err.code === 'ENOENT') tryNext();
  });

  proc.once('exit', (code) => {
    if (soundProc === proc) soundProc = null;
    // Non-zero exit: command exists but failed (e.g. paplay with no audio device).
    if (code !== 0 && code !== null) tryNext();
  });
}

function playSound(config) {
  if (soundProc) {
    try { soundProc.kill(); } catch (_) {}
    soundProc = null;
  }

  const players = getPlayers(getSoundPath(config));
  if (players.length === 0) return;

  playWithFallback(players, 0);
}

function notify() {
  const now = Date.now();
  if (now - lastNotifyAt < COOLDOWN_MS) return;
  const config = loadConfig();
  if (config.muted) return;
  lastNotifyAt = now;

  playSound(config);
  notifier.notify({
    title: 'blooop 🔔',
    message: 'Your agent needs you',
    sound: false,
  });
}

module.exports = { notify };
