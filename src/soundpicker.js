'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.blooop.json');
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

function getBuiltinSounds() {
  try {
    return fs.readdirSync(SOUNDS_DIR)
      .filter(f => /\.(wav|mp3|ogg|aiff?)$/i.test(f))
      .sort()
      .map(f => ({ label: path.basename(f, path.extname(f)), path: path.join(SOUNDS_DIR, f) }));
  } catch (_) {
    return [];
  }
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveConfig(config) {
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
}

/**
 * Show an inline sound picker. Temporarily takes over stdin; calls onDone when finished.
 *
 * @param {NodeJS.ReadStream} stdin
 * @param {NodeJS.WriteStream} stdout
 * @param {() => void} onDone
 */
function showSoundPicker(stdin, stdout, onDone) {
  // Save cursor position so we can fully restore terminal state when done.
  // This prevents the picker's output from corrupting the host app's display.
  try { stdout.write('\x1b7'); } catch (_) { onDone(); return; }

  const builtins = getBuiltinSounds();

  // "default" is always option 1; skip the "bloop" entry since default already covers it.
  const options = [
    { label: 'default (bloop)', path: null },
    ...builtins.filter(s => s.label !== 'bloop'),
  ];

  const config = loadConfig();
  const currentPath = config.sound ? path.resolve(config.sound) : null;
  const muted = !!config.muted;

  const muteLabel = muted ? '\x1b[33mmuted\x1b[0m' : 'active';
  const lines = [
    '',
    `\x1b[1mblooop\x1b[0m  pick a sound  [${muteLabel}]  (\x1b[2m1-${options.length}  m to ${muted ? 'unmute' : 'mute'}  esc to cancel\x1b[0m)`,
  ];
  options.forEach((opt, i) => {
    const active = !muted && (opt.path ? opt.path === currentPath : currentPath === null);
    const marker = active ? '\x1b[32m●\x1b[0m' : '○';
    lines.push(`  ${marker} ${i + 1}. ${opt.label}`);
  });
  try {
    stdout.write(lines.join('\r\n') + '\r\n');
  } catch (_) {
    try { stdout.write('\x1b8'); } catch (_2) {}
    onDone();
    return;
  }

  function eraseMenu() {
    try { stdout.write(`\x1b[${lines.length}A\x1b[0J`); } catch (_) {}
  }

  function restoreCursor() {
    try { stdout.write('\x1b8'); } catch (_) {}
  }

  function onKey(data) {
    const key = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

    if (key === '\x1b' || key === '\x03' || key === '\x02') {
      stdin.off('data', onKey);
      eraseMenu();
      restoreCursor();
      onDone();
      return;
    }

    if (key === 'm' || key === 'M') {
      stdin.off('data', onKey);
      const cfg = loadConfig();
      cfg.muted = !cfg.muted;
      eraseMenu();

      let confirmMsg = '';
      try {
        saveConfig(cfg);
        confirmMsg = cfg.muted ? '\x1b[33msound muted\x1b[0m' : '\x1b[32msound unmuted\x1b[0m';
      } catch (_) {
        confirmMsg = '\x1b[31merror saving config\x1b[0m';
      }

      try { stdout.write(confirmMsg); } catch (_) {}

      const muteTimer = setTimeout(() => {
        try { stdout.write('\r\x1b[2K'); } catch (_) {}
        restoreCursor();
        onDone();
      }, 1200);
      if (typeof muteTimer.unref === 'function') muteTimer.unref();
      return;
    }

    const num = parseInt(key, 10);
    if (num >= 1 && num <= options.length) {
      stdin.off('data', onKey);
      const chosen = options[num - 1];
      const cfg = loadConfig();
      if (chosen.path === null) {
        delete cfg.sound;
      } else {
        cfg.sound = chosen.path;
      }
      delete cfg.muted;
      eraseMenu();

      let confirmMsg = '';
      try {
        saveConfig(cfg);
        confirmMsg = `\x1b[32msound → ${chosen.label}\x1b[0m`;
      } catch (_) {
        confirmMsg = '\x1b[31merror saving config\x1b[0m';
      }

      // Write confirmation on the current line (no trailing newline).
      // After a brief delay, erase it and restore the cursor so the host
      // app's terminal state is left exactly as it was before the picker.
      try { stdout.write(confirmMsg); } catch (_) {}

      const timer = setTimeout(() => {
        try { stdout.write('\r\x1b[2K'); } catch (_) {} // erase confirmation line
        restoreCursor();
        onDone();
      }, 1200);
      if (typeof timer.unref === 'function') timer.unref();
    }
    // ignore anything else
  }

  stdin.on('data', onKey);
}

module.exports = { showSoundPicker };
