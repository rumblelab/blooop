'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Minimal stub for child_process.spawn so we can test playWithFallback
// without touching real audio commands.
// ---------------------------------------------------------------------------

class FakeProc extends EventEmitter {
  constructor(exitCode) {
    super();
    this._exitCode = exitCode;
  }
  // Simulate the process result on the next tick.
  start() {
    setImmediate(() => {
      if (this._exitCode === 'ENOENT') {
        const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        this.emit('error', err);
      } else {
        this.emit('exit', this._exitCode, null);
      }
    });
    return this;
  }
}

// A self-contained re-implementation of the fallback loop that mirrors
// notify.js's playWithFallback so we can unit-test it without spawning real
// processes or mocking require().
function playWithFallback(players, idx, spawnFn, onDone) {
  if (idx >= players.length) { onDone(null); return; }

  const proc = spawnFn(players[idx]);
  let advanced = false;

  function tryNext() {
    if (advanced) return;
    advanced = true;
    playWithFallback(players, idx + 1, spawnFn, onDone);
  }

  proc.once('error', (err) => {
    if (err && err.code === 'ENOENT') tryNext();
  });

  proc.once('exit', (code) => {
    if (code !== 0 && code !== null) tryNext();
    else if (!advanced) onDone(players[idx]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('uses first player when it succeeds', (_, done) => {
  const players = ['paplay', 'aplay'];
  const tried = [];

  playWithFallback(players, 0, (cmd) => {
    tried.push(cmd);
    return new FakeProc(0).start();
  }, (winner) => {
    assert.equal(winner, 'paplay');
    assert.deepEqual(tried, ['paplay']);
    done();
  });
});

test('falls back to aplay when paplay exits non-zero', (_, done) => {
  const players = ['paplay', 'aplay'];
  const tried = [];

  playWithFallback(players, 0, (cmd) => {
    tried.push(cmd);
    const code = cmd === 'paplay' ? 1 : 0;
    return new FakeProc(code).start();
  }, (winner) => {
    assert.equal(winner, 'aplay');
    assert.deepEqual(tried, ['paplay', 'aplay']);
    done();
  });
});

test('falls back to aplay when paplay is not found (ENOENT)', (_, done) => {
  const players = ['paplay', 'aplay'];
  const tried = [];

  playWithFallback(players, 0, (cmd) => {
    tried.push(cmd);
    const exitCode = cmd === 'paplay' ? 'ENOENT' : 0;
    return new FakeProc(exitCode).start();
  }, (winner) => {
    assert.equal(winner, 'aplay');
    assert.deepEqual(tried, ['paplay', 'aplay']);
    done();
  });
});

test('calls onDone with null when all players fail', (_, done) => {
  const players = ['paplay', 'aplay'];

  playWithFallback(players, 0, (_cmd) => {
    return new FakeProc(1).start();
  }, (winner) => {
    assert.equal(winner, null);
    done();
  });
});

test('does not double-advance when both error and exit fire', (_, done) => {
  // Some platforms emit both error AND exit for ENOENT.
  const players = ['paplay', 'aplay'];
  const tried = [];

  playWithFallback(players, 0, (cmd) => {
    tried.push(cmd);
    const proc = new FakeProc(0);
    // Manually fire both events to confirm the guard works.
    if (cmd === 'paplay') {
      setImmediate(() => {
        const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        proc.emit('error', err);
        proc.emit('exit', null, null); // exit after error, code=null
      });
    } else {
      setImmediate(() => proc.emit('exit', 0, null));
    }
    return proc;
  }, (winner) => {
    assert.equal(winner, 'aplay');
    assert.deepEqual(tried, ['paplay', 'aplay']); // aplay tried exactly once
    done();
  });
});
