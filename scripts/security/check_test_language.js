#!/usr/bin/env node
/**
 * Enforces docs/SECURITY_TEST_CONTENT_POLICY.md.
 *
 * `icanbwell/fhir-server` is public. A test path, a describe block or a comment that
 * names an incident, or that characterizes a code path as leaking or vulnerable, is
 * readable by anyone and is durable: it stays in the file tree, in CI log lines, in
 * GitHub code search and in every fork. This script makes the policy a check rather
 * than something a reviewer has to remember.
 *
 * Scope, by default: files added or modified relative to the base ref, plus everything
 * under src/tests/security regardless of whether it changed. The rest of the tree is
 * not scanned by default, because it predates the policy and remediating it is tracked
 * separately; `--all` scans it anyway for that remediation work.
 *
 *   node scripts/security/check_test_language.js                # changed files + security dir
 *   node scripts/security/check_test_language.js --all          # whole test tree, audit mode
 *   node scripts/security/check_test_language.js --base=main    # explicit base ref
 *
 * Exit code 1 on any violation. A line may be exempted with a trailing
 * `// security-language-ok: <reason>` when the term is unavoidable and benign, for
 * example a Node memory-leak assertion or a quoted HITRUST control title.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ALWAYS_SCAN = 'src/tests/security';
const TEST_TREE = 'src/tests';
const EXEMPT = /\/\/\s*security-language-ok:/;

// Each rule is deliberately narrow. Broad word matching produces noise (`exposure` in a
// quoted control title, `leak` in a heap assertion) and noise is how a check gets disabled.
const RULES = [
    {
        id: 'incident-id',
        // Incident and security-finding trackers. Feature tickets (DCON, QUAL) are fine:
        // they describe work, not an event.
        re: /\b(INC|SEC|VULN)-\d+\b/g,
        why: 'names an incident or security-finding ticket. Cite the specification rule id (IDG-5, SAE-2, CL-1, AUTH-1) instead.'
    },
    {
        id: 'characterization',
        // The noun/verb forms that characterize the code as having lost data or being
        // attackable. `leaked`, `leaking`, `leakage` included; `leak` alone is not, because
        // memory-leak assertions are legitimate and common in this tree.
        re: /\b(leakage|leaking|leaked|leaks\s+(?:phi|data|records|patient)|breach(?:ed|es)?|exfiltrat\w*|vulnerabilit(?:y|ies)|vulnerable|attack\s+surface|exploit(?:ed|able)?)\b/gi,
        why: 'characterizes the code as having lost data or as attackable. State the required behavior: a record is returned or withheld, a control is applied or not applied.'
    },
    {
        id: 'phi-claim',
        // PHI paired with a loss verb. Bare `PHI` is allowed: it is the correct clinical
        // term and appears in legitimate assertions about what must not be logged.
        re: /\bPHI\b[^.\n]{0,40}\b(leak\w*|expos\w*|disclos\w*|steal|stolen|breach\w*)\b|\b(leak\w*|expos\w*|disclos\w*|steal|stolen|breach\w*)\b[^.\n]{0,40}\bPHI\b/gi,
        why: 'asserts that protected health information was or can be lost. Describe the record set: tenant A must not receive tenant B\'s records.'
    },
    {
        id: 'observed-in-environment',
        re: /\b(on|in|against)\s+(staging|prod|production|dev)\b[^.\n]{0,60}\b(returned|reachable|readable|leaked|exposed|confirmed|reproduc\w*)\b/gi,
        why: 'states what was observed in a deployed environment. Describe the shape under test using the synthetic fixtures the test creates.'
    },
    {
        id: 'deployed-identifier',
        // Two things are deliberately not matched, because flagging them would make this
        // check noise and a noisy check gets turned off:
        //   `www.icanbwell.com/...` — the security tag systems (`/owner`, `/access`,
        //     `/sourceAssigningAuthority`) are canonical URIs in the data model, not hosts.
        //   `fhir.icanbwell.com` and `fhir.dev.icanbwell.com` — the repo's standard test
        //     base URLs, present in several hundred expected-response fixtures.
        // What is matched is a non-public environment hostname or an identity-pool id.
        re: /\b(us-(?:east|west)-\d_[A-Za-z0-9]{8,}|(?:[a-z0-9-]+\.)*(?:staging|stage|qa|uat|prod|production)\.icanbwell\.com)\b/g,
        why: 'is a non-public environment hostname or an identity-pool id. Use a placeholder.'
    }
];

// Path rules apply to the file path itself, which is the most durable surface: it shows in
// every CI log line and in the rendered file tree whether or not anyone opens the file.
const PATH_RULES = [
    {
        id: 'path-characterization',
        re: /(leak|breach|vulnerab|exploit|phi_?leak|exfil)/i,
        why: 'the file or directory name characterizes the code. Rename to describe the property under test (…_isolation, …_scoping, …_authorization).'
    },
    {
        id: 'path-incident-id',
        re: /\b(inc|sec|vuln)[-_]?\d{2,}\b/i,
        why: 'the file or directory name embeds an incident or security-finding ticket number.'
    }
];

function sh (cmd) {
    try {
        return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
}

function walk (dir, out = []) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === 'fixtures') continue;
            walk(rel, out);
        } else if (e.name.endsWith('.js') || e.name.endsWith('.md')) {
            out.push(rel);
        }
    }
    return out;
}

function targets (argv) {
    if (argv.includes('--all')) return walk(TEST_TREE);
    const baseArg = argv.find(a => a.startsWith('--base='));
    // GITHUB_BASE_REF is a bare branch name in a pull_request run, so it needs the remote
    // prefix to resolve. On a push to main there is no base ref and the diff is empty,
    // which leaves the always-scan set.
    const base = baseArg
        ? baseArg.split('=')[1]
        : (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
    const diff = sh(`git diff --name-only --diff-filter=d ${base}...HEAD`);
    const changed = diff ? diff.split('\n').filter(Boolean) : [];
    if (!changed.length && !sh('git rev-parse --verify --quiet ' + base)) {
        // A shallow checkout cannot produce the diff. Say so rather than reporting a clean
        // run over a scope that quietly shrank to one directory.
        console.warn(`security-language: base ref ${base} is not present (shallow checkout?); scanning ${ALWAYS_SCAN} only.`);
    }
    const set = new Set(
        changed.filter(f => (f.endsWith('.js') || f.endsWith('.md')) && !f.includes('/fixtures/'))
    );
    walk(ALWAYS_SCAN).forEach(f => set.add(f));
    // This script states the banned terms in order to detect them.
    set.delete(path.relative(ROOT, __filename));
    set.delete('docs/SECURITY_TEST_CONTENT_POLICY.md');
    return [...set].filter(f => fs.existsSync(path.join(ROOT, f)));
}

function main () {
    const files = targets(process.argv.slice(2));
    const violations = [];

    for (const file of files) {
        for (const rule of PATH_RULES) {
            const m = file.match(rule.re);
            if (m) violations.push({ file, line: 0, rule: rule.id, text: m[0], why: rule.why });
        }
        const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
        lines.forEach((line, i) => {
            // The marker may sit on the offending line or on the line above it, so a long
            // justification does not have to be crammed onto the end of a code line.
            if (EXEMPT.test(line) || (i > 0 && EXEMPT.test(lines[i - 1]))) return;
            for (const rule of RULES) {
                rule.re.lastIndex = 0;
                const m = rule.re.exec(line);
                if (m) violations.push({ file, line: i + 1, rule: rule.id, text: m[0].trim(), why: rule.why });
            }
        });
    }

    if (!violations.length) {
        console.log(`security-language: ${files.length} file(s) scanned, clean.`);
        return 0;
    }

    console.error(`security-language: ${violations.length} violation(s) in ${files.length} file(s) scanned.`);
    console.error('Policy: docs/SECURITY_TEST_CONTENT_POLICY.md\n');
    for (const v of violations) {
        const where = v.line ? `${v.file}:${v.line}` : `${v.file} (path)`;
        console.error(`  ${where}\n    [${v.rule}] "${v.text}" ${v.why}\n`);
    }
    console.error('If a match is unavoidable and benign, append `// security-language-ok: <reason>` to the line.');
    return 1;
}

process.exit(main());
