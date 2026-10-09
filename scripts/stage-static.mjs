// Vercel builds the already-tested static release committed to this repository.
// No dependency installation, cloud credentials, or remote frontend rebuild is needed.
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1].slice(1));
if (assets.length === 0 || /src="\/src\//.test(html)) throw new Error('Build the static release locally before deploying.');
for (const asset of assets) if (!existsSync(asset)) throw new Error(`Missing committed asset: ${asset}`);
mkdirSync('dist', { recursive: true });
for (const name of ['index.html', 'assets', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', '_headers']) {
  cpSync(name, `dist/${name}`, { recursive: true });
}
console.log('Prepared the committed static release for hosting.');
