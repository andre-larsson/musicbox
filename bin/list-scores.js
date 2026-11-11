// Every .scrim file under scores/, as paths relative to the repo root, sorted.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listScores(root, dir = join(root, 'scores'), prefix = 'scores') {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...listScores(root, join(dir, e.name), prefix + '/' + e.name));
    else if (e.name.endsWith('.scrim')) out.push(prefix + '/' + e.name);
  }
  return out.sort();
}
