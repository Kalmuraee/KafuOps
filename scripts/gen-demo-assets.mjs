#!/usr/bin/env node
// Generates brand-matched SVG "terminal" cards (and one animated SVG "recording")
// for the KafuOps live demo. Content mirrors a real `kafuops incidents open-mr`
// run via the claude-cli provider on examples/demo-discount. Dependency-free.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? 'assets/demo');
fs.mkdirSync(OUT, { recursive: true });

const COL = {
  fg: '#cdd6e4', dim: '#7d8590', green: '#3fb950', red: '#f85149',
  yellow: '#d29922', teal: '#2dd4bf', blue: '#79c0ff', plus: '#3fb950', minus: '#f85149',
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function card(title, lines, { width = 820 } = {}) {
  const padX = 22, top = 56, lh = 22, fs = 14;
  const height = top + lines.length * lh + 22;
  const rows = lines
    .map((l, i) => {
      const color = l.color ?? COL.fg;
      const weight = l.bold ? ' font-weight="600"' : '';
      return `<text x="${padX}" y="${top + i * lh}" fill="${color}"${weight} xml:space="preserve">${esc(l.text)}</text>`;
    })
    .join('\n  ');
  return { width, height, body: `
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="#0d1117" stroke="#21262d"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="34" rx="12" fill="#161b22"/>
  <rect x="0.5" y="22" width="${width - 1}" height="12" fill="#161b22"/>
  <circle cx="20" cy="17" r="6" fill="#f85149"/><circle cx="40" cy="17" r="6" fill="#d29922"/><circle cx="60" cy="17" r="6" fill="#3fb950"/>
  <text x="${width / 2}" y="22" fill="${COL.dim}" text-anchor="middle" font-size="12">${esc(title)}</text>
  ${rows}` };
}

function wrap(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14">${c.body}\n</svg>\n`;
}

// ---- real demo content ----
const f1 = [
  { text: '$ node test.js            # the bug, before KafuOps', color: COL.dim },
  { text: 'AssertionError: 20% off $100 should be $80   (got -1900)', color: COL.red },
  { text: '' },
  { text: '$ kafuops incidents open-mr inc_demo_discount   (provider: claude CLI)', color: COL.teal, bold: true },
  { text: 'Open MR for inc_demo_discount', color: COL.fg },
  { text: '  analyze  →  plan  →  patch  →  sandbox: node test.js', color: COL.dim },
  { text: '! attempt 1: patch did not apply → read failure → revise', color: COL.yellow },
  { text: '✓ attempt 2: patch applied, tests passed   (self-correcting loop)', color: COL.green },
  { text: '  confidence=80 (high)   risk=low', color: COL.fg },
  { text: '! MR ready for review — saved mr-body.md', color: COL.yellow },
];
const f2 = [
  { text: 'diff --git a/src/discount.js b/src/discount.js', color: COL.dim },
  { text: '@@ -1,5 +1,5 @@', color: COL.blue },
  { text: ' function applyDiscount(price, percent) {', color: COL.fg },
  { text: '-  return price - price * percent;', color: COL.minus },
  { text: '+  return price - price * (percent / 100);', color: COL.plus },
  { text: ' }', color: COL.fg },
  { text: '', color: COL.fg },
  { text: '# the model found the unit bug: percent is 0–100, not a fraction', color: COL.dim },
];
const f3 = [
  { text: '# KafuOps Incident Fix', color: COL.teal, bold: true },
  { text: 'Files changed:  src/discount.js', color: COL.fg },
  { text: 'Validation:     node test.js  →  tests passed: yes', color: COL.green },
  { text: 'Confidence:     80 / 100 (high)', color: COL.fg },
  { text: '  + stack_trace_maps_to_changed_file', color: COL.green },
  { text: '  + targeted_tests_passed', color: COL.green },
  { text: '  + patch_is_small', color: COL.green },
  { text: 'Blast radius:   low', color: COL.fg },
  { text: 'Labels:         kafuops · incident-fix · needs-review · confidence-high', color: COL.dim },
];

const frames = [
  { name: '01-run', title: 'kafuops — incident → fix', lines: f1 },
  { name: '02-diff', title: 'the patch KafuOps generated', lines: f2 },
  { name: '03-mr', title: 'the merge request', lines: f3 },
];

for (const fr of frames) {
  fs.writeFileSync(path.join(OUT, `${fr.name}.svg`), wrap(card(fr.title, fr.lines)));
}

// ---- animated "recording": cycle the frames with SMIL ----
const W = 820;
const H = Math.max(...frames.map((f) => card(f.title, f.lines).height));
const groups = frames
  .map((fr, i) => {
    const c = card(fr.title, fr.lines, {});
    const vals = frames.map((_, j) => (j === i ? 1 : 0)).join(';');
    return `<g opacity="${i === 0 ? 1 : 0}"><animate attributeName="opacity" calcMode="discrete" dur="${frames.length * 4}s" repeatCount="indefinite" keyTimes="${frames.map((_, j) => (j / frames.length).toFixed(3)).join(';')}" values="${vals}"/>${c.body}</g>`;
  })
  .join('\n');
const animated = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14">
<rect width="${W}" height="${H}" fill="#0d1117"/>
${groups}
</svg>\n`;
fs.writeFileSync(path.join(OUT, 'recording.svg'), animated);

console.log(`wrote ${frames.length + 1} svg(s) to ${OUT}`);
