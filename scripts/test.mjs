import { build } from 'esbuild';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const source = resolve('tests');
const files = (await readdir(source)).filter((name) => name.endsWith('.test.ts'));
if (!files.length) throw new Error('No tests found in tests/*.test.ts');
const output = await mkdtemp(join(tmpdir(), 'formulary-tests-'));
try {
  await build({
    entryPoints: files.map((name) => join(source, name)),
    outdir: output,
    outExtension: { '.js': '.mjs' },
    platform: 'node',
    format: 'esm',
    target: 'node24',
    bundle: true,
    sourcemap: 'inline',
    logLevel: 'warning',
  });
  const status = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--test', ...files.map((name) => join(output, name.replace(/\.ts$/, '.mjs')))], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => done(code ?? 1));
  });
  process.exitCode = status;
} finally {
  await rm(output, { recursive: true, force: true });
}
