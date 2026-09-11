import { cp, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve('.next/standalone');
await access(resolve(destination, 'server.js'));
await mkdir(resolve(destination, '.next'), { recursive: true });
await cp(resolve('.next/static'), resolve(destination, '.next/static'), { recursive: true, force: true });
try { await access('public'); await cp(resolve('public'), resolve(destination, 'public'), { recursive: true, force: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Standalone package includes static assets, fonts and worker chunks.');
