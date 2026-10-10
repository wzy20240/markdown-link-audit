import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 8000;

export function extractLinks(markdown) {
  const links = [];
  let inFence = false;
  const lines = markdown.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const pattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>]+)>/g;
    for (const match of line.matchAll(pattern)) {
      const target = (match[1] ?? match[2]).replace(/^<|>$/g, '');
      links.push({ line: index + 1, target });
    }
  }
  return links;
}

export async function checkLink(target, sourceFile, { localOnly = false, fetchImpl = fetch } = {}) {
  if (/^(#|mailto:|tel:)/i.test(target)) return null;
  if (/^https?:\/\//i.test(target)) {
    if (localOnly) return null;
    try {
      let response = await fetchImpl(target, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ([405, 501].includes(response.status)) {
        response = await fetchImpl(target, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
        await response.body?.cancel();
      }
      return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, reason: error.name === 'TimeoutError' ? 'timed out' : 'request failed' };
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;

  const localPath = decodeURIComponent(target.split(/[?#]/, 1)[0]);
  if (!localPath) return null;
  try {
    await stat(resolve(dirname(sourceFile), localPath));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'file not found' };
  }
}

export async function audit(files, options = {}) {
  const results = [];
  for (const file of files) {
    const markdown = await readFile(file, 'utf8');
    for (const link of extractLinks(markdown)) {
      const result = await checkLink(link.target, file, options);
      if (result) results.push({ file, ...link, ...result });
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local-only');
  const files = args.filter(arg => arg !== '--local-only');
  if (files.length === 0) {
    console.error('Usage: node src/cli.mjs [--local-only] FILE.md [FILE.md ...]');
    process.exitCode = 2;
    return;
  }

  try {
    const results = await audit(files, { localOnly });
    for (const result of results) {
      console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.file}:${result.line}  ${result.target}${result.ok ? '' : `  (${result.reason})`}`);
    }
    const failed = results.filter(result => !result.ok).length;
    console.log(`\nChecked ${results.length} links: ${results.length - failed} passed, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
