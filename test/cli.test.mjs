import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit, checkLink, extractLinks } from '../src/cli.mjs';

test('extracts inline links and autolinks, skipping fenced code', () => {
  const links = extractLinks('[Guide](guide.md)\n```\n[Skip](missing.md)\n```\n<https://example.com>');
  assert.deepEqual(links, [
    { line: 1, target: 'guide.md' },
    { line: 5, target: 'https://example.com' }
  ]);
});

test('checks existing and missing local files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'link-audit-'));
  try {
    await writeFile(join(dir, 'guide.md'), '# Guide\n');
    await writeFile(join(dir, 'index.md'), '[Good](guide.md)\n[Bad](missing.md)\n');
    const results = await audit([join(dir, 'index.md')], { localOnly: true });
    assert.deepEqual(results.map(result => [result.ok, result.reason]), [[true, undefined], [false, 'file not found']]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('retries GET when HEAD is not supported', async () => {
  const methods = [];
  const fetchImpl = async (_url, options) => {
    methods.push(options.method);
    return options.method === 'HEAD'
      ? { status: 405, ok: false }
      : { status: 200, ok: true, body: { cancel: async () => {} } };
  };
  assert.deepEqual(await checkLink('https://example.com', 'README.md', { fetchImpl }), { ok: true });
  assert.deepEqual(methods, ['HEAD', 'GET']);
});
