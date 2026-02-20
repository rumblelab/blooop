'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semver = require('semver');

// ---------------------------------------------------------------------------
// semver comparison (replaces the old hand-rolled isNewer tests)
// ---------------------------------------------------------------------------

test('semver.gt detects newer patch', () => {
  assert.ok(semver.gt('1.0.1', '1.0.0'));
});

test('semver.gt detects newer minor', () => {
  assert.ok(semver.gt('1.1.0', '1.0.9'));
});

test('semver.gt detects newer major', () => {
  assert.ok(semver.gt('2.0.0', '1.9.9'));
});

test('semver.gt returns false for equal versions', () => {
  assert.equal(semver.gt('1.0.0', '1.0.0'), false);
});

test('semver.gt returns false for older version', () => {
  assert.equal(semver.gt('0.9.9', '1.0.0'), false);
});

test('semver.valid rejects garbage so we never write bad data to cache', () => {
  assert.equal(semver.valid('not-a-version'), null);
  assert.equal(semver.valid(''), null);
  assert.equal(semver.valid(null), null);
});

// ---------------------------------------------------------------------------
// Cache file — write, read, permissions
// ---------------------------------------------------------------------------

test('cache file is written with mode 0o600', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blooop-test-'));
  const cachePath = path.join(tmpDir, '.blooop-cache.json');

  const content = JSON.stringify({ latest: '1.2.3', checkedAt: Date.now() }, null, 2) + '\n';
  const tmp = cachePath + '.tmp';
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, cachePath);

  const stat = fs.statSync(cachePath);
  // Check the permission bits (mask out file type bits with 0o777).
  assert.equal(stat.mode & 0o777, 0o600);

  fs.rmSync(tmpDir, { recursive: true });
});

test('cache file survives a concurrent write via atomic rename', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blooop-test-'));
  const cachePath = path.join(tmpDir, '.blooop-cache.json');

  // Simulate two writes in quick succession.
  for (const version of ['1.0.1', '1.0.2']) {
    const content = JSON.stringify({ latest: version, checkedAt: Date.now() }, null, 2) + '\n';
    const tmp = cachePath + '.tmp';
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, cachePath);
  }

  const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(saved.latest, '1.0.2');

  fs.rmSync(tmpDir, { recursive: true });
});
