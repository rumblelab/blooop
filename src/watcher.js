'use strict';

// Patterns that indicate the agent is waiting for user input.
const PROMPT_PATTERNS = [
  /\(y\/n\)/i,
  /yes\/no/i,
  /press enter/i,
  /do you want/i,
  /proceed\?/i,
  /confirm/i,
];

// Claude Code shows this specific prompt text when idle and waiting for input.
// Matching it gives a positive signal rather than relying purely on silence.
const CLAUDE_IDLE_PATTERNS = [
  // The "> " or "› " prompt that appears when Claude Code is waiting.
  // Requires a trailing space (Claude always renders "› " or "> ") to avoid
  // matching bash/node REPL continuation prompts which emit bare ">".
  /^\s*[>›]\s+$/m,
  // "? for shortcuts" hint line Claude shows at the input prompt
  /\? for shortcuts/,
];

const DEFAULT_IDLE_MS = 4000;
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const FOCUS_EVENT_RE = /\x1b\[(?:I|O)/g;
const STATE = Object.freeze({
  IDLE: 'idle',
  PROMPT: 'prompt',
  NOTIFIED: 'notified',
});

function stripAnsi(input) {
  return String(input).replace(ANSI_ESCAPE_RE, '');
}

function isMeaningfulUserInput(data) {
  if (data === undefined || data === null) return true;

  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (text.length === 0) return false;

  // Strip ANSI escape sequences and terminal focus events.
  const stripped = stripAnsi(text.replace(FOCUS_EVENT_RE, ''));

  // Strip remaining bare ESC characters and non-printable control chars,
  // but preserve \r (0x0d) and \n (0x0a) which indicate submission.
  // This prevents escape keypresses and arrow-key navigation from re-arming
  // the watcher and triggering false blooops.
  const printable = stripped.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return printable.length > 0;
}

function isSubmission(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  return text.includes('\r') || text.includes('\n');
}

/**
 * Watch a PTY data stream and call onTrigger when the agent needs attention.
 *
 * @param {import('node-pty').IPty} pty
 * @param {(reason: 'idle' | 'prompt') => void} onTrigger
 * @param {{ idleMs?: number, promptPatterns?: RegExp[], enableIdle?: boolean }} [options]
 */
function watch(pty, onTrigger, options = {}) {
  const idleMs = Number.isFinite(options.idleMs) ? options.idleMs : DEFAULT_IDLE_MS;
  const enableIdle = options.enableIdle !== false;
  const promptPatterns = Array.isArray(options.promptPatterns) && options.promptPatterns.length > 0
    ? options.promptPatterns
    : PROMPT_PATTERNS;

  let state = STATE.IDLE;
  let idleTimer = null;
  let hadOutput = false;
  let userHasInteracted = false;
  // Only true after the user has pressed Enter — guards against echo-while-typing blooops.
  let awaitingResponse = false;
  let stopped = false;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function trigger(reason) {
    if (stopped || state === STATE.NOTIFIED) return;
    awaitingResponse = false;
    if (reason === 'prompt') state = STATE.PROMPT;
    onTrigger(reason);
    state = STATE.NOTIFIED;
  }

  function resetIdle() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (stopped || state !== STATE.IDLE) return;
      if (!hadOutput || !userHasInteracted || !awaitingResponse) return;
      trigger('idle');
    }, idleMs);
  }

  pty.onData((data) => {
    if (stopped) return;

    hadOutput = true;

    if (state === STATE.IDLE && userHasInteracted) {
      const cleanData = stripAnsi(data);

      // Positive match: Claude's idle prompt is visible — bloop immediately.
      // Requires awaitingResponse so that backspacing to empty (which causes
      // Claude to re-render its "› " prompt) does not trigger a false bloop.
      if (awaitingResponse) {
        for (const pattern of CLAUDE_IDLE_PATTERNS) {
          if (pattern.test(cleanData)) {
            clearIdleTimer();
            trigger('idle');
            return;
          }
        }
      }

      for (const pattern of promptPatterns) {
        if (pattern.test(cleanData)) {
          clearIdleTimer();
          trigger('prompt');
          return;
        }
      }
    }

    // Only run the silence timer if the user actually submitted something.
    if (state === STATE.IDLE && enableIdle && awaitingResponse) {
      resetIdle();
    }
  });

  return {
    onUserInput(data) {
      if (stopped) return false;
      if (!isMeaningfulUserInput(data)) return false;
      userHasInteracted = true;
      state = STATE.IDLE;
      hadOutput = false;
      clearIdleTimer();
      awaitingResponse = false;

      // Only arm the idle timer after the user presses Enter (submits their message).
      // This prevents echo of mid-composition keystrokes from triggering the timer.
      if (isSubmission(data)) {
        awaitingResponse = true;
      }

      return true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearIdleTimer();
    },
    getState() {
      return state;
    },
  };
}

module.exports = { watch };
