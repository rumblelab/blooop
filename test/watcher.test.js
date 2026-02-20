'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { watch } = require('../src/watcher');

class FakePty {
  constructor() {
    this.handlers = [];
  }

  onData(handler) {
    this.handlers.push(handler);
  }

  emitData(data) {
    for (const handler of this.handlers) {
      handler(data);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('does not trigger before user input', async () => {
  const pty = new FakePty();
  const reasons = [];
  watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  pty.emitData('Do you want to continue? (y/n)');
  await sleep(40);
  assert.deepEqual(reasons, []);
});

test('triggers on ANSI-colored prompt after user input', () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  assert.equal(watcher.getState(), 'idle');
  watcher.onUserInput();
  pty.emitData('\u001b[33mDo you want to continue? (y/n)\u001b[0m');

  assert.deepEqual(reasons, ['prompt']);
  assert.equal(watcher.getState(), 'notified');
});

test('triggers once per idle period and resets on user input', async () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  watcher.onUserInput('\r');
  pty.emitData('working...');
  await sleep(40);
  assert.deepEqual(reasons, ['idle']);
  assert.equal(watcher.getState(), 'notified');

  await sleep(40);
  assert.deepEqual(reasons, ['idle']);

  watcher.onUserInput('\r');
  pty.emitData('next turn');
  await sleep(40);
  assert.deepEqual(reasons, ['idle', 'idle']);
});

test('stop clears timers and prevents late notifications', async () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  watcher.onUserInput('\r');
  pty.emitData('about to stop');
  watcher.stop();
  await sleep(40);

  assert.deepEqual(reasons, []);
});

test('focus in/out control events do not re-arm notifications', async () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  watcher.onUserInput('\r');
  pty.emitData('first turn output');
  await sleep(40);
  assert.deepEqual(reasons, ['idle']);

  const rearmedOnFocusIn = watcher.onUserInput(Buffer.from('\u001b[I', 'utf8'));
  const rearmedOnFocusOut = watcher.onUserInput(Buffer.from('\u001b[O', 'utf8'));
  assert.equal(rearmedOnFocusIn, false);
  assert.equal(rearmedOnFocusOut, false);

  pty.emitData('background output');
  await sleep(40);
  assert.deepEqual(reasons, ['idle']);
});

test('escape key and arrow keys do not re-arm notifications', async () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  // User submits input, idle fires
  watcher.onUserInput('\r');
  pty.emitData('some output');
  await sleep(40);
  assert.deepEqual(reasons, ['idle']);

  // User presses Escape (bare ESC) — should not re-arm
  const rearmedOnEsc = watcher.onUserInput('\x1b');
  assert.equal(rearmedOnEsc, false);

  // User presses double-Escape — should not re-arm
  const rearmedOnDoubleEsc = watcher.onUserInput('\x1b\x1b');
  assert.equal(rearmedOnDoubleEsc, false);

  // User presses arrow key — should not re-arm
  const rearmedOnArrow = watcher.onUserInput('\x1b[A');
  assert.equal(rearmedOnArrow, false);

  // Claude re-renders its prompt in response — should NOT bloop again
  pty.emitData('> ');
  await sleep(40);
  assert.deepEqual(reasons, ['idle']);
});

test('backspacing to empty input does not trigger when claude re-renders its prompt', () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20 });

  // User types a character (no Enter) — userHasInteracted becomes true, awaitingResponse stays false
  watcher.onUserInput('h');
  // User backspaces — filtered as non-meaningful, state unchanged
  watcher.onUserInput('\x7f');
  // Claude re-renders its idle prompt after the backspace
  pty.emitData('› ');

  assert.deepEqual(reasons, []);
});

test('idle detection can be disabled while keeping prompt detection', async () => {
  const pty = new FakePty();
  const reasons = [];
  const watcher = watch(pty, (reason) => {
    reasons.push(reason);
  }, { idleMs: 20, enableIdle: false });

  watcher.onUserInput('x');
  pty.emitData('plain output');
  await sleep(40);
  assert.deepEqual(reasons, []);

  watcher.onUserInput('x');
  pty.emitData('Do you want to continue? (y/n)');
  assert.deepEqual(reasons, ['prompt']);
});
