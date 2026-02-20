#!/usr/bin/env node
'use strict';

const os = require('os');
const pty = require('node-pty');
const { watch } = require('../src/watcher');
const { notify } = require('../src/notify');
const { showSoundPicker } = require('../src/soundpicker');

const { checkForUpdate } = require('../src/updater');
const { version } = require('../package.json');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: blooop <command> [args...]');
  console.error('Try: blooop --demo');
  process.exit(1);
}

if (args[0] === '--demo') {
  process.stdout.write('🔔 \x1b[1mblooop\x1b[0m demo mode\r\n');
  process.stdout.write('Playing sound and showing notification in 3 seconds...\r\n');
  setTimeout(() => {
    notify();
    process.stdout.write('\r\n✅ Done! If you didn\'t hear anything, check your system volume and notification settings.\r\n');
    process.exit(0);
  }, 3000);
  return;
}

const debugEnabled = /^(1|true|yes)$/i.test(String(process.env.BLOOOP_DEBUG || ''));
const idleMsFromEnv = Number.parseInt(process.env.BLOOOP_IDLE_MS || '', 10);
const disableIdle = /^(1|true|yes)$/i.test(String(process.env.BLOOOP_DISABLE_IDLE || ''));
const disableUpdateCheck = /^(1|true|yes)$/i.test(String(process.env.BLOOOP_NO_UPDATE_CHECK || ''));

if (!disableUpdateCheck) checkForUpdate(version);

const [cmd, ...cmdArgs] = args;

function debug(message) {
  if (!debugEnabled) return;
  process.stderr.write(`[blooop] ${message}\n`);
}

let shell;
try {
  shell = pty.spawn(cmd, cmdArgs, {
    name: 'xterm-256color',
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: process.cwd(),
    env: process.env,
  });
} catch (err) {
  console.error(`Failed to start command "${cmd}": ${err.message}`);
  process.exit(1);
}

let rawModeEnabled = false;
let cleanedUp = false;
let shuttingDown = false;
let pickerActive = false;
let signalExitTimer = null;
let watcher = null;
let ptyOutputBuffered = false;

function restoreTerminal() {
  if (!rawModeEnabled) return;
  try {
    process.stdin.setRawMode(false);
  } catch (_) {
    // Ignore cleanup errors when stdin is no longer available.
  }
  rawModeEnabled = false;
}

function signalToExitCode(signal) {
  if (!signal) return 1;
  if (typeof signal === 'number') return 128 + signal;

  const code = os.constants.signals[signal];
  return Number.isFinite(code) ? 128 + code : 1;
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (signalExitTimer) {
    clearTimeout(signalExitTimer);
    signalExitTimer = null;
  }

  if (watcher) watcher.stop();
  restoreTerminal();
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  cleanup();
  removeListeners();
  process.exit(exitCode);
}

function onProcessExit() {
  cleanup();
}

function forwardSignal(signal) {
  if (shuttingDown) return;
  try { shell.kill(signal); } catch (_) {}

  if (signalExitTimer) clearTimeout(signalExitTimer);
  signalExitTimer = setTimeout(() => {
    shutdown(signalToExitCode(signal));
  }, 250);

  if (typeof signalExitTimer.unref === 'function') {
    signalExitTimer.unref();
  }
}

function onSigInt() {
  forwardSignal('SIGINT');
}

function onSigTerm() {
  forwardSignal('SIGTERM');
}

function onShellData(data) {
  // While the sound picker is on the alternate screen, Claude Code's PTY may
  // emit \x1b[?1049l (its own alternate-screen restore) which would flip us
  // back to the main screen mid-picker. Buffer and discard PTY output during
  // this window; Claude Code will redraw after we send a resize signal.
  if (ptyOutputBuffered) return;
  process.stdout.write(data);
}

function onShellExit({ exitCode, signal }) {
  const finalCode = Number.isInteger(exitCode) ? exitCode : signalToExitCode(signal);
  if (finalCode === 127) {
    console.error(`blooop: command not found: ${cmd}`);
  }
  shutdown(finalCode);
}

function onStdinData(data) {
  if (pickerActive) return;

  const key = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (key === '\x02') { // Ctrl+B — open sound picker
    pickerActive = true;
    ptyOutputBuffered = true;
    showSoundPicker(process.stdin, process.stdout, () => {
      ptyOutputBuffered = false;
      pickerActive = false;
      // Force Claude Code to redraw its UI now that the main screen is back.
      // Sending a resize with the same dimensions triggers SIGWINCH, which
      // causes Claude Code to re-render and recover the input line.
      try { shell.resize(process.stdout.columns || 80, process.stdout.rows || 24); } catch (_) {}
    });
    return;
  }

  const rearmed = watcher.onUserInput(data);
  if (rearmed) {
    debug('watcher re-armed from user input');
  } else {
    debug('ignored non-user control input');
  }
  shell.write(data);
}

function onStdinEnd() {
  // Only send EOF (^D) in TTY mode. In piped usage the PTY handles EOF
  // naturally when the pipe closes; forwarding ^D would inject a stray
  // control character into the child's input stream.
  if (!process.stdin.isTTY) return;
  try {
    shell.write('\x04');
  } catch (_) {}
}

function onResize() {
  shell.resize(process.stdout.columns, process.stdout.rows);
}

function removeListeners() {
  process.stdin.off('data', onStdinData);
  process.stdin.off('end', onStdinEnd);
  process.stdout.off('resize', onResize);
  process.off('SIGINT', onSigInt);
  process.off('SIGTERM', onSigTerm);
  process.off('exit', onProcessExit);
}

// Forward PTY output to stdout
shell.onData(onShellData);

// Watch for idle / prompts
watcher = watch(shell, (reason) => {
  debug(`triggered notification (reason=${reason || 'unknown'})`);
  notify();
}, {
  idleMs: Number.isFinite(idleMsFromEnv) && idleMsFromEnv > 0 ? idleMsFromEnv : undefined,
  enableIdle: !disableIdle,
});

// Forward stdin to PTY; reset watcher on each keypress
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  rawModeEnabled = true;
}
process.stdin.resume();
process.stdin.on('data', onStdinData);
process.stdin.on('end', onStdinEnd);

// Resize PTY when terminal window resizes
process.stdout.on('resize', onResize);
process.on('SIGINT', onSigInt);
process.on('SIGTERM', onSigTerm);
process.on('exit', onProcessExit);

// Exit when the child exits
shell.onExit(onShellExit);
