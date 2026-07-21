const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'node_modules', 'nf3', 'dist', '_chunks', 'trace.mjs');

if (!fs.existsSync(target)) {
  console.log('[postinstall] nf3 trace module not found; skipping patch');
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');
const oldText = 'import { nodeFileTrace } from "@vercel/nft";';
const newText = 'import nft from "@vercel/nft";\nconst { nodeFileTrace } = nft;';

if (!source.includes(oldText)) {
  console.log('[postinstall] nf3 trace import already patched or not present');
  process.exit(0);
}

fs.writeFileSync(target, source.replace(oldText, newText));
console.log('[postinstall] patched nf3 trace import for Netlify compatibility');
