/**
 * Reports how close each directly-pinned dependency sits to the release-age
 * floor. pnpm already enforces the floor across every lockfile entry — this
 * answers the other question: how much margin is left before a routine bump
 * starts failing CI.
 *
 * Network-dependent, so it warns rather than failing when the registry is
 * unreachable. The gate is pnpm's verification pass, not this.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

const floorMinutes = Number(
  /minimumReleaseAge:\s*(\d+)/.exec(readFileSync('pnpm-workspace.yaml', 'utf8'))?.[1] ?? 0,
);
if (!floorMinutes) {
  console.log('  no minimumReleaseAge configured — nothing to report');
  process.exit(0);
}
const floorDays = floorMinutes / 1440;
const cutoff = Date.now() - floorMinutes * 60_000;

const pins = new Map();
for (const file of ['package.json', ...globSync('{apps,packages}/*/package.json')]) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const bucket of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(json[bucket] ?? {})) {
      if (/^\d+\.\d+\.\d+$/.test(range)) pins.set(`${name}@${range}`, { name, version: range });
    }
  }
}

const rows = [];
for (const { name, version } of pins.values()) {
  let published;
  try {
    published = JSON.parse(
      execFileSync('npm', ['view', `${name}@${version}`, 'time', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )[version];
  } catch {
    console.log(`  ! could not reach the registry for ${name} — skipping the margin report`);
    process.exit(0);
  }
  const ageDays = (Date.now() - new Date(published)) / 86_400_000;
  rows.push({ name, version, ageDays, eligible: new Date(published).getTime() <= cutoff });
}

rows.sort((a, b) => a.ageDays - b.ageDays);
const ineligible = rows.filter((r) => !r.eligible);
for (const r of rows.slice(0, 3)) {
  console.log(`  ${r.eligible ? 'ok  ' : 'FAIL'} ${r.name}@${r.version}  ${r.ageDays.toFixed(1)}d`);
}
console.log(
  `  ${rows.length} pinned dependencies · floor ${floorDays.toFixed(0)}d · tightest margin ${(rows[0].ageDays - floorDays).toFixed(1)}d`,
);
if (ineligible.length) {
  console.error(`  ${ineligible.length} pinned dependencies are inside the floor`);
  process.exit(1);
}
