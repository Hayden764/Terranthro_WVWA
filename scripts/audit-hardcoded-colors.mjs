#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const strict = process.argv.includes('--strict');

const targets = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ignoreFiles = new Set([
  'src/config/topographyConfig.js',
  'src/config/climateConfig.js',
  'src/components/ClimateLayer.jsx',
  'src/components/TopographyLayer.jsx',
  'src/components/dock/glassTokens.js',
]);

const allowedLinePatterns = [
  /MAP_COLORS/, // centralized map constants
  /'line-color'|'fill-color'|'circle-color'|'text-halo-color'/, // MapLibre style expressions
  /colors:\s*\[/, // legend arrays in config-like objects
  /boxShadow:\s*'0\s+\d+px\s+\d+px\s+rgba\(/, // common neutral shadow
  /ctx\.strokeStyle\s*=/, // canvas overlay drawing color
  /(referenceLineColor|passiveLineColor|linkedLineColor|linkedFillColor)\s*=/, // centralized vineyard style colors
];

const colorPattern = /(#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\))/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (targets.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function rel(full) {
  return path.relative(root, full).split(path.sep).join('/');
}

function lineAllowed(line) {
  return allowedLinePatterns.some((p) => p.test(line));
}

function blockIgnored(lines, idx) {
  let ignoreDepth = 0;
  for (let i = 0; i <= idx; i += 1) {
    if (lines[i].includes('audit-ignore-start')) ignoreDepth += 1;
    if (lines[i].includes('audit-ignore-end')) ignoreDepth = Math.max(0, ignoreDepth - 1);
  }
  return ignoreDepth > 0;
}

const findings = [];
for (const filePath of walk(srcRoot)) {
  const fileRel = rel(filePath);
  if (ignoreFiles.has(fileRel)) continue;
  if (!fileRel.startsWith('src/components/') && !fileRel.startsWith('src/pages/')) continue;

  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, idx) => {
    if (blockIgnored(lines, idx)) return;
    if (lineAllowed(line)) return;
    const matches = line.match(colorPattern);
    if (!matches) return;

    findings.push({
      file: fileRel,
      line: idx + 1,
      colors: [...new Set(matches)].join(', '),
      snippet: line.trim().slice(0, 180),
    });
  });
}

if (findings.length === 0) {
  console.log('No hardcoded color literals found in src/components and src/pages.');
  process.exit(0);
}

console.log(`Found ${findings.length} hardcoded color literal lines.`);
console.log('Top 80 findings:');
for (const f of findings.slice(0, 80)) {
  console.log(`- ${f.file}:${f.line} | ${f.colors}`);
}

if (strict) {
  process.exit(1);
}

console.log('\nNon-strict mode: reporting only. Use --strict to fail.');
