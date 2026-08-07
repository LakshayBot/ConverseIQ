/* Global class sweep: raw Tailwind palette -> Opaline semantic tokens.
   Run from callpilot-desktop/frontend: node scripts/sweep-tokens.mjs */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), 'src');

// Ordered: overlay patterns first, then exact classes (longest first).
const RULES = [
  // Overlays
  ['bg-black bg-opacity-50', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/60', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/50', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/40', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/30', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/20', 'bg-[var(--opaline-overlay)]'],
  ['bg-black/10', 'bg-[var(--opaline-tone-8)]'],
  ['bg-black/5', 'bg-[var(--opaline-tone-4)]'],
  ['bg-black/5 ', 'bg-[var(--opaline-tone-4)] '],

  // Hover blues -> primary hover
  ['hover:bg-blue-700', 'hover:bg-[var(--opaline-primary-hover)]'],
  ['hover:bg-blue-600', 'hover:bg-[var(--opaline-primary-hover)]'],
  ['hover:text-blue-800', 'hover:text-primary'],

  // Blues -> primary / info
  ['bg-blue-600', 'bg-primary'],
  ['bg-blue-500', 'bg-primary'],
  ['bg-blue-700', 'bg-[var(--opaline-primary-hover)]'],
  ['bg-blue-100', 'bg-[var(--opaline-info-soft)]'],
  ['bg-blue-50', 'bg-[var(--opaline-info-soft)]'],
  ['text-blue-600', 'text-primary'],
  ['text-blue-500', 'text-[var(--opaline-info)]'],
  ['text-blue-700', 'text-[var(--opaline-info)]'],
  ['text-blue-800', 'text-[var(--opaline-info)]'],
  ['text-blue-400', 'text-[var(--opaline-info)]'],
  ['border-blue-500', 'border-primary'],
  ['border-blue-600', 'border-primary'],
  ['border-blue-200', 'border-[var(--opaline-info-border)]'],
  ['ring-blue-600', 'ring-ring'],
  ['ring-blue-500', 'ring-ring'],
  ['ring-blue-300', 'ring-ring'],
  ['from-blue-500', 'from-primary'],
  ['to-blue-600', 'to-[var(--opaline-primary-hover)]'],

  // Greys -> text
  ['text-gray-900', 'text-[var(--opaline-on-surface)]'],
  ['text-gray-800', 'text-[var(--opaline-on-surface)]'],
  ['text-gray-700', 'text-[var(--opaline-on-surface-variant)]'],
  ['text-gray-600', 'text-[var(--opaline-on-surface-variant)]'],
  ['text-gray-500', 'text-[var(--opaline-outline)]'],
  ['text-gray-400', 'text-[var(--opaline-outline)]'],
  ['text-gray-300', 'text-[var(--opaline-outline)]'],
  ['text-gray-200', 'text-[var(--opaline-outline-variant)]'],
  ['text-gray-100', 'text-[var(--opaline-outline-variant)]'],

  // Greys -> backgrounds
  ['hover:bg-gray-200', 'hover:bg-[var(--opaline-surface-container)]'],
  ['hover:bg-gray-100', 'hover:bg-[var(--opaline-surface-container-low)]'],
  ['hover:bg-gray-50', 'hover:bg-[var(--opaline-surface-container-low)]'],
  ['hover:bg-gray-800', 'hover:bg-[var(--opaline-ink-hover)]'],
  ['bg-gray-900', 'bg-[var(--opaline-ink)]'],
  ['bg-gray-800', 'bg-[var(--opaline-ink)]'],
  ['bg-gray-700', 'bg-[var(--opaline-ink-hover)]'],
  ['bg-gray-400', 'bg-[var(--opaline-outline)]'],
  ['bg-gray-300', 'bg-[var(--opaline-surface-container-high)]'],
  ['bg-gray-200', 'bg-[var(--opaline-surface-container)]'],
  ['bg-gray-100', 'bg-[var(--opaline-surface-container-low)]'],
  ['bg-gray-50', 'bg-[var(--opaline-surface-container-low)]'],

  // Greys -> borders
  ['border-gray-900', 'border-[var(--opaline-ink)]'],
  ['border-gray-300', 'border-[var(--opaline-outline-variant)]'],
  ['border-gray-200', 'border-[var(--opaline-outline-variant)]'],
  ['border-gray-100', 'border-[var(--opaline-outline-variant)]'],
  ['divide-gray-200', 'divide-[var(--opaline-outline-variant)]'],
  ['divide-gray-100', 'divide-[var(--opaline-outline-variant)]'],

  // White
  ['hover:bg-white', 'hover:bg-[var(--opaline-surface-container-lowest)]'],
  ['bg-white', 'bg-[var(--opaline-surface-container-lowest)]'],

  // Reds -> danger
  ['hover:bg-red-700', 'hover:bg-[var(--opaline-danger-border)]'],
  ['hover:bg-red-50', 'hover:bg-[var(--opaline-danger-soft)]'],
  ['hover:text-red-800', 'hover:text-danger'],
  ['bg-red-700', 'bg-danger'],
  ['bg-red-600', 'bg-danger'],
  ['bg-red-500', 'bg-danger'],
  ['bg-red-100', 'bg-[var(--opaline-danger-soft)]'],
  ['bg-red-50', 'bg-[var(--opaline-danger-soft)]'],
  ['text-red-800', 'text-danger'],
  ['text-red-700', 'text-danger'],
  ['text-red-600', 'text-danger'],
  ['text-red-500', 'text-danger'],
  ['text-red-400', 'text-danger'],
  ['text-red-300', 'text-danger'],
  ['border-red-300', 'border-[var(--opaline-danger-border)]'],
  ['border-red-200', 'border-[var(--opaline-danger-border)]'],

  // Greens/emerald -> success
  ['hover:bg-green-600', 'hover:bg-[var(--opaline-success-border)]'],
  ['hover:bg-green-100', 'hover:bg-[var(--opaline-success-soft)]'],
  ['bg-green-600', 'bg-success'],
  ['bg-green-500', 'bg-success'],
  ['bg-green-100', 'bg-[var(--opaline-success-soft)]'],
  ['bg-green-50', 'bg-[var(--opaline-success-soft)]'],
  ['text-green-800', 'text-success'],
  ['text-green-700', 'text-success'],
  ['text-green-600', 'text-success'],
  ['text-green-500', 'text-success'],
  ['text-green-400', 'text-success'],
  ['border-green-200', 'border-[var(--opaline-success-border)]'],
  ['bg-emerald-500', 'bg-success'],
  ['bg-emerald-100', 'bg-[var(--opaline-success-soft)]'],
  ['text-emerald-500', 'text-success'],
  ['text-emerald-600', 'text-success'],

  // Amber/yellow/orange -> warning
  ['hover:bg-amber-500', 'hover:bg-[var(--opaline-warning-border)]'],
  ['bg-amber-500', 'bg-warning'],
  ['bg-amber-100', 'bg-[var(--opaline-warning-soft)]'],
  ['bg-amber-50', 'bg-[var(--opaline-warning-soft)]'],
  ['text-amber-900', 'text-warning'],
  ['text-amber-800', 'text-warning'],
  ['text-amber-700', 'text-warning'],
  ['text-amber-600', 'text-warning'],
  ['text-amber-500', 'text-warning'],
  ['border-amber-300', 'border-[var(--opaline-warning-border)]'],
  ['border-amber-200', 'border-[var(--opaline-warning-border)]'],
  ['bg-yellow-500', 'bg-warning'],
  ['bg-yellow-100', 'bg-[var(--opaline-warning-soft)]'],
  ['bg-yellow-50', 'bg-[var(--opaline-warning-soft)]'],
  ['text-yellow-900', 'text-warning'],
  ['text-yellow-800', 'text-warning'],
  ['text-yellow-700', 'text-warning'],
  ['text-yellow-600', 'text-warning'],
  ['text-yellow-500', 'text-warning'],
  ['border-yellow-300', 'border-[var(--opaline-warning-border)]'],
  ['border-yellow-200', 'border-[var(--opaline-warning-border)]'],
  ['bg-orange-500', 'bg-warning'],
  ['bg-orange-100', 'bg-[var(--opaline-warning-soft)]'],
  ['text-orange-700', 'text-warning'],
  ['text-orange-600', 'text-warning'],
  ['text-orange-500', 'text-warning'],

  // Slate/zinc/stone
  ['bg-slate-100', 'bg-[var(--opaline-surface-container-low)]'],
  ['bg-slate-50', 'bg-[var(--opaline-surface-container-low)]'],
  ['bg-slate-200', 'bg-[var(--opaline-surface-container)]'],
  ['text-slate-600', 'text-[var(--opaline-on-surface-variant)]'],
  ['text-slate-500', 'text-[var(--opaline-outline)]'],
  ['text-slate-400', 'text-[var(--opaline-outline)]'],
  ['border-slate-300', 'border-[var(--opaline-outline-variant)]'],
  ['border-slate-200', 'border-[var(--opaline-outline-variant)]'],
  ['divide-slate-200', 'divide-[var(--opaline-outline-variant)]'],
  ['bg-zinc-900', 'bg-[var(--opaline-ink)]'],
  ['bg-zinc-800', 'bg-[var(--opaline-ink)]'],
  ['text-zinc-500', 'text-[var(--opaline-outline)]'],
  ['text-zinc-400', 'text-[var(--opaline-outline)]'],
  ['text-stone-600', 'text-[var(--opaline-on-surface-variant)]'],
  ['text-stone-500', 'text-[var(--opaline-outline)]'],
  ['text-stone-400', 'text-[var(--opaline-outline)]'],
  ['border-stone-300', 'border-[var(--opaline-outline-variant)]'],
  ['border-stone-200', 'border-[var(--opaline-outline-variant)]'],
  ['bg-stone-50', 'bg-[var(--opaline-surface-container-low)]'],
  ['bg-stone-100', 'bg-[var(--opaline-surface-container-low)]'],

  // Black alpha borders (IntelligencePanel cards)
  ['border-black/[0.08]', 'border-[var(--opaline-tone-8)]'],
  ['border-black/[0.06]', 'border-[var(--opaline-tone-4)]'],
  ['border-black/10', 'border-[var(--opaline-tone-8)]'],
  ['border-black/5', 'border-[var(--opaline-tone-4)]'],
  ['ring-black/5', 'ring-[var(--opaline-tone-4)]'],
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(p) === '.tsx' || extname(p) === '.ts' || extname(p) === '.css') out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let total = 0;
const perFile = [];
for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let before = content;
  let fileCount = 0;
  for (const [from, to] of RULES) {
    while (content.includes(from)) {
      content = content.replace(from, to);
      fileCount++;
    }
  }
  if (content !== before) {
    writeFileSync(file, content);
    total += fileCount;
    perFile.push(`${fileCount.toString().padStart(4)}  ${file.replace(ROOT + '/', '')}`);
  }
}
perFile.sort((a, b) => parseInt(b) - parseInt(a));
console.log(`Files changed: ${perFile.length}, total replacements: ${total}`);
console.log(perFile.join('\n'));
