// Keep this static-host repository runnable while retaining editable source.
// Run after npm run build. This writes only local deployment artifacts.
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const html = readFileSync('dist/index.html', 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1]);
for (const asset of assets) {
  if (!existsSync(`dist${asset}`)) throw new Error(`Missing built asset: ${asset}`);
}
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const headers = readFileSync('_headers', 'utf8').replace(/script-src [^;]+;/, `script-src 'self' ${inline.join(' ')};`);
mkdirSync('assets', { recursive: true });
cpSync('dist/assets', 'assets', { recursive: true });
const builtAssets = new Set(readdirSync('dist/assets'));
for (const file of readdirSync('assets')) {
  if (/^index-[\w-]+\.(js|css)$/.test(file) && !builtAssets.has(file)) unlinkSync(join('assets', file));
}
writeFileSync('index.html', html);
writeFileSync('_headers', headers);
writeFileSync('dist/_headers', headers);
// Vercel ignores _headers; carry the same policies in its own configuration.
const headerRules = [];
for (const line of headers.split('\n')) {
  if (line.startsWith('/')) {
    headerRules.push({ source: line.replace(/\*$/, '(.*)'), headers: [] });
  } else if (line.trim() && headerRules.length) {
    const separator = line.indexOf(':');
    if (separator > 0) headerRules.at(-1).headers.push({ key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() });
  }
}
writeFileSync('vercel.json', JSON.stringify({
  version: 2,
  framework: null,
  installCommand: 'echo Using the committed static release',
  buildCommand: 'node scripts/stage-static.mjs',
  outputDirectory: 'dist',
  headers: headerRules,
}, null, 2) + '\n');
for (const file of readdirSync('public')) cpSync(join('public', file), file, { recursive: true });
// Remove only superseded bundles at the root, from the original flattened export.
for (const file of ['index-DY6aDBy2.js', 'index-Covz3XYt.css', 'role.js']) {
  if (existsSync(file)) unlinkSync(file);
}
console.log(`Static site rebuilt with ${assets.length} verified entry assets. No deployment performed.`);
