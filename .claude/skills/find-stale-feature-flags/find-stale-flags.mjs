#!/usr/bin/env node
/**
 * Finds feature flags in the ui-platform codebase and identifies those
 * introduced more than N months ago (default: 6).
 *
 * Usage: node find-stale-flags.mjs [months_threshold]
 */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, realpathSync } from 'fs';
import { isAbsolute, join, relative } from 'path';

const THRESHOLD_MONTHS = parseInt(process.argv[2] || '6', 10);
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const cutoffDate = new Date();
cutoffDate.setMonth(cutoffDate.getMonth() - THRESHOLD_MONTHS);
const cutoffStr = cutoffDate.toISOString().slice(0, 10);

function findFiles(dir, pattern) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(dir, fullPath);
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist'
        )
          continue;
        results.push(...findFiles(fullPath, pattern));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results;
}

function extractFlags(filePath) {
  const flags = new Set();
  try {
    const resolvedPath = realpathSync(filePath);
    if (!resolvedPath.startsWith(REPO_ROOT)) {
      return flags;
    }
    const content = readFileSync(resolvedPath, 'utf8');
    if (
      filePath.includes('.test.') ||
      filePath.includes('__mocks__') ||
      filePath.includes('mock')
    )
      return flags;

    // Pattern 1: useFeatureFlagValue('flag-name', ...) or useFeatureFlagValue<T>('flag-name', ...)
    const directMatches = content.matchAll(
      /useFeatureFlagValue(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g,
    );
    for (const m of directMatches) {
      flags.add(m[1]);
    }

    // Pattern 2: useSearchParamFeatureFlag('flag-name', ...)
    const searchParamMatches = content.matchAll(
      /useSearchParamFeatureFlag(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g,
    );
    for (const m of searchParamMatches) {
      flags.add(m[1]);
    }

    // Pattern 3: Constants defined and used with useFeatureFlagValue
    // e.g., const MY_FLAG = 'flag-name'; ... useFeatureFlagValue(MY_FLAG, ...)
    if (
      content.includes('useFeatureFlagValue') ||
      content.includes('useSearchParamFeatureFlag')
    ) {
      const constMatches = content.matchAll(
        /const\s+(\w+)\s*=\s*['"]([a-z][a-z0-9 _-]+)['"]/gi,
      );
      for (const m of constMatches) {
        const constName = m[1];
        const value = m[2];
        if (
          content.includes(`useFeatureFlagValue(${constName}`) ||
          content.includes(`useSearchParamFeatureFlag(${constName}`)
        ) {
          flags.add(value);
        }
      }
    }
  } catch {
    /* skip unreadable files */
  }
  return flags;
}

function gitFirstSeen(flagStr) {
  try {
    const result = execFileSync(
      'git',
      [
        'log',
        '--all',
        '--diff-filter=A',
        '--format=%ai',
        `-S${flagStr}`,
        '--',
        '*.ts',
        '*.tsx',
      ],
      { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 },
    ).trim();
    const lines = result.split('\n').filter(Boolean);
    if (lines.length > 0) {
      return lines[lines.length - 1].slice(0, 10);
    }

    // Fallback: any commit that mentions this string
    const fallback = execFileSync(
      'git',
      ['log', '--all', '--format=%ai', `-S${flagStr}`, '--', '*.ts', '*.tsx'],
      { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 },
    ).trim();
    const fallbackLines = fallback.split('\n').filter(Boolean);
    if (fallbackLines.length > 0) {
      return fallbackLines[fallbackLines.length - 1].slice(0, 10);
    }
  } catch {
    /* git command failed */
  }
  return null;
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

// --- Main ---

console.log('=== Stale Feature Flag Report ===');
console.log(
  `Threshold: flags introduced before ${cutoffStr} (${THRESHOLD_MONTHS} months ago)`,
);
console.log('Scanning codebase...\n');

const tsFiles = [
  ...findFiles(join(REPO_ROOT, 'libs'), /\.(tsx?|jsx?)$/),
  ...findFiles(join(REPO_ROOT, 'apps'), /\.(tsx?|jsx?)$/),
];

// Collect all flags and their locations
const flagLocations = new Map(); // flag -> Set<filePath>

for (const file of tsFiles) {
  const flags = extractFlags(file);
  for (const flag of flags) {
    if (!flagLocations.has(flag)) flagLocations.set(flag, new Set());
    flagLocations.get(flag).add(relative(REPO_ROOT, file));
  }
}

console.log(`Found ${flagLocations.size} unique feature flags.\n`);

// Look up git history for each flag
const results = [];
const today = new Date().toISOString().slice(0, 10);

for (const [flag, files] of flagLocations) {
  process.stderr.write(`  Checking: ${flag}...\r`);
  const firstSeen = gitFirstSeen(flag);
  const age = firstSeen ? daysBetween(firstSeen, today) : null;
  const status = !firstSeen
    ? 'UNKNOWN'
    : firstSeen < cutoffStr
      ? 'STALE'
      : 'OK';

  results.push({
    flag,
    firstSeen: firstSeen || 'unknown',
    ageDays: age !== null ? age : '?',
    files: [...files],
    status,
  });
}

process.stderr.write('                                        \r');

// Sort: STALE first (oldest first), then OK, then UNKNOWN
results.sort((a, b) => {
  const statusOrder = { STALE: 0, UNKNOWN: 1, OK: 2 };
  if (statusOrder[a.status] !== statusOrder[b.status]) {
    return statusOrder[a.status] - statusOrder[b.status];
  }
  if (a.firstSeen === 'unknown') return 1;
  if (b.firstSeen === 'unknown') return -1;
  return a.firstSeen.localeCompare(b.firstSeen);
});

// Output
const stale = results.filter((r) => r.status === 'STALE');
const ok = results.filter((r) => r.status === 'OK');
const unknown = results.filter((r) => r.status === 'UNKNOWN');

if (stale.length > 0) {
  console.log(
    `\n## STALE FLAGS (>${THRESHOLD_MONTHS} months old) — ${stale.length} found\n`,
  );
  console.log('| Flag | First Seen | Age | Location(s) |');
  console.log('|------|-----------|-----|-------------|');
  for (const r of stale) {
    const loc =
      r.files.length <= 2
        ? r.files.join(', ')
        : `${r.files[0]} (+${r.files.length - 1} more)`;
    console.log(`| \`${r.flag}\` | ${r.firstSeen} | ${r.ageDays}d | ${loc} |`);
  }
}

if (ok.length > 0) {
  console.log(
    `\n## OK FLAGS (<${THRESHOLD_MONTHS} months old) — ${ok.length} found\n`,
  );
  console.log('| Flag | First Seen | Age | Location(s) |');
  console.log('|------|-----------|-----|-------------|');
  for (const r of ok) {
    const loc =
      r.files.length <= 2
        ? r.files.join(', ')
        : `${r.files[0]} (+${r.files.length - 1} more)`;
    console.log(`| \`${r.flag}\` | ${r.firstSeen} | ${r.ageDays}d | ${loc} |`);
  }
}

if (unknown.length > 0) {
  console.log(`\n## UNKNOWN AGE — ${unknown.length} found\n`);
  console.log('| Flag | Location(s) |');
  console.log('|------|-------------|');
  for (const r of unknown) {
    const loc =
      r.files.length <= 2
        ? r.files.join(', ')
        : `${r.files[0]} (+${r.files.length - 1} more)`;
    console.log(`| \`${r.flag}\` | ${loc} |`);
  }
}

console.log('\n=== Summary ===');
console.log(`Total flags: ${results.length}`);
console.log(`Stale (>${THRESHOLD_MONTHS} months): ${stale.length}`);
console.log(`OK (<${THRESHOLD_MONTHS} months): ${ok.length}`);
console.log(`Unknown age: ${unknown.length}`);
console.log(`Cutoff date: ${cutoffStr}`);

if (stale.length > 0) {
  console.log('\n=== Recommended Actions ===');
  console.log('For each STALE flag, verify with the team whether:');
  console.log(
    '  1. The feature is fully rolled out → remove the flag and dead code path',
  );
  console.log('  2. The feature was abandoned → remove both code paths');
  console.log('  3. The flag is still needed → document why in a comment');
}
