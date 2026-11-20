import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CI packages Darwin on a supported ARM64 runner', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /os:\s*macos-14(?:\s|$)/);
  assert.match(workflow, /os:\s*macos-15\s*\n\s+platform:\s*darwin-arm64/);
});
