#!/usr/bin/env node
/**
 * Unified route ↔ component resolver for ui-platform.
 *
 * Modes:
 *   --path <url-path>           Forward: URL → component (instant)
 *   --url <full-url>            Forward: full URL → component (instant)
 *   --component <query>         Reverse: component/registry key → URL (instant)
 *   --trace <name>              Trace: component → full parent chain via ts-morph (~8s)
 *   --list-routes               List all routes in config (instant)
 *
 * Common flags:
 *   --repo-root <path>          (required for --component/--trace) ui-platform root
 *   --env <env>                 Environment for config lookup
 *   --client-slug <slug>        Client for config lookup
 *   --mfe <mfe-name>            Narrow trace to specific MFE (e.g., mfe-medicine)
 *   --depth <n>                 Max trace depth (default: 5)
 *   --verbose                   Show full matched node JSON
 *
 * Exit codes: 0 = found, 1 = not found/unreachable, 2 = usage error
 */
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, relative, resolve } from 'path';
import { parseArgs } from 'util';

// --- Argument Parsing ---

const { values: args } = parseArgs({
  options: {
    path: { type: 'string' },
    url: { type: 'string' },
    component: { type: 'string' },
    trace: { type: 'string' },
    file: { type: 'string' },
    'repo-root': { type: 'string' },
    'list-routes': { type: 'boolean', default: false },
    env: { type: 'string' },
    'client-slug': { type: 'string' },
    mfe: { type: 'string' },
    depth: { type: 'string', default: '5' },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.error(`Usage:
  node resolve_route.mjs --path /medicines              # URL → component
  node resolve_route.mjs --component medicineDetails    # registry key → URL
  node resolve_route.mjs --trace PricingItem --mfe mfe-medicine  # component → chain
  node resolve_route.mjs --file libs/mfe-medicine/src/component/PricingItem/PricingItem.tsx  # file → trace
  node resolve_route.mjs --list-routes                  # show all routes`);
  process.exit(2);
}

const EXIT_FOUND = 0;
const EXIT_NOT_FOUND = 1;
const EXIT_USAGE_ERROR = 2;

const CACHE_DIR = join(homedir(), '.claude', 'skills', 'client-hub', '.cache');

// --- Path Validation ---

function validatePath(target, base) {
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(base);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith('..') || resolve(resolvedBase, rel) !== resolvedTarget) {
    throw new Error(`Invalid file path: ${target} is outside ${base}`);
  }
  return resolvedTarget;
}

// --- Repo Root Detection ---

function findRepoRoot() {
  if (args['repo-root']) {
    const p = resolve(args['repo-root']);
    if (
      !existsSync(
        join(
          p,
          'apps',
          'composite',
          'src',
          'app',
          'embeddable',
          'mainRegistry.tsx',
        ),
      )
    ) {
      console.error(
        `WARNING: --repo-root '${p}' does not contain mainRegistry.tsx`,
      );
    }
    return p;
  }

  const hasRegistry = (d) => {
    const target = join(
      resolve(d),
      'apps',
      'composite',
      'src',
      'app',
      'embeddable',
      'mainRegistry.tsx',
    );
    const rel = relative(resolve(d), target);
    if (rel.startsWith('..')) return false;
    return existsSync(target);
  };

  const envRoot = process.env.UI_PLATFORM_ROOT;
  if (envRoot && existsSync(envRoot) && hasRegistry(resolve(envRoot)))
    return resolve(envRoot);

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    if (hasRegistry(gitRoot)) return gitRoot;
  } catch {}

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (hasRegistry(dir)) return dir;
    dir = dirname(dir);
  }
  return null;
}

// --- Config File Discovery ---

function findConfigFile() {
  if (!existsSync(CACHE_DIR)) return null;

  const env = args.env;
  const slug = args['client-slug'];
  let pattern;
  if (env && slug)
    pattern = `config-${env}-${slug}-embeddable_configuration.json`;
  else if (env) pattern = `config-${env}-`;
  else if (slug) pattern = `-${slug}-embeddable_configuration.json`;
  else pattern = 'config-';

  const files = readdirSync(CACHE_DIR)
    .filter(
      (f) =>
        f.includes('embeddable_configuration.json') && f.startsWith('config-'),
    )
    .filter((f) => {
      if (env && slug) return f === pattern;
      return f.includes(pattern);
    });

  if (files.length === 0) return null;
  if (files.length === 1) return join(CACHE_DIR, files[0]);
  // Pick most recent
  const sorted = files
    .map((f) => {
      try {
        return { f, mtime: statSync(join(CACHE_DIR, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return sorted.length > 0 ? join(CACHE_DIR, sorted[0].f) : null;
}

function loadRouteTree(configFile) {
  const validPath = validatePath(configFile, CACHE_DIR);
  const data = JSON.parse(readFileSync(validPath, 'utf-8'));
  const rd = data.routeDefinition;
  if (!rd) {
    console.error('ERROR: No routeDefinition field in config');
    process.exit(EXIT_USAGE_ERROR);
  }
  return typeof rd === 'string' ? JSON.parse(rd) : rd;
}

// --- Registry Parsing ---

function parseRegistry(repoRoot) {
  const registryPath = join(
    repoRoot,
    'apps',
    'composite',
    'src',
    'app',
    'embeddable',
    'mainRegistry.tsx',
  );
  if (!existsSync(registryPath)) return { entries: {}, content: '' };

  const validPath = validatePath(registryPath, repoRoot);
  const content = readFileSync(validPath, 'utf-8');
  const entries = {};
  const entryRe = /^\s+(\w+):\s*\{/gm;
  const importRe = /import\(['"]([^'"]+)['"]\)\)\s*\.(\w+)/s;

  const allMatches = [];
  let match;
  while ((match = entryRe.exec(content)) !== null) {
    allMatches.push({ key: match[1], start: match.index });
  }

  for (let i = 0; i < allMatches.length; i++) {
    const { key, start } = allMatches[i];
    const end =
      i + 1 < allMatches.length ? allMatches[i + 1].start : content.length;
    const block = content.slice(start, end);
    const imp = importRe.exec(block);
    if (imp) {
      const pkg = imp[1];
      const comp = imp[2];
      if (!entries[comp]) entries[comp] = [];
      entries[comp].push({
        key,
        package: pkg,
        line: content.slice(0, start).split('\n').length,
      });
    }
  }
  return { entries, content };
}

// --- Route Tree Walking ---

function pathMatches(pathSegments, urlSegments) {
  if (pathSegments.length !== urlSegments.length) return false;
  return pathSegments.every(
    (ps, i) => ps.startsWith(':') || ps === urlSegments[i],
  );
}

function findRoute(nodes, segments, trail = []) {
  if (!segments.length) {
    const indexChild = nodes.find((n) => n.index);
    return indexChild
      ? { match: indexChild, trail: [...trail, indexChild] }
      : null;
  }

  for (const node of nodes) {
    const path = (node.path || '').replace(/^\/|\/$/g, '');

    // Layout wrapper
    if (!path && !node.index && node.children) {
      const result = findRoute(node.children, segments, [...trail, node]);
      if (result) return result;
      continue;
    }

    if (path === '*') return { match: node, trail: [...trail, node] };

    const pathParts = path.split('/').filter(Boolean);
    if (!pathParts.length) continue;

    if (pathMatches(pathParts, segments.slice(0, pathParts.length))) {
      const remaining = segments.slice(pathParts.length);
      if (!remaining.length) {
        const indexChild = (node.children || []).find((c) => c.index);
        if (indexChild)
          return { match: indexChild, trail: [...trail, node, indexChild] };
        return { match: node, trail: [...trail, node] };
      }
      if (node.children) {
        const result = findRoute(node.children, remaining, [...trail, node]);
        if (result) return result;
      }
    }
  }
  return null;
}

function findUrlsForRegistryKey(routeTree, targetKey) {
  const matches = [];
  function walk(nodes, currentPath) {
    for (const node of nodes) {
      const path = (node.path || '').replace(/^\/|\/$/g, '');
      const elementId = node.elementId || node.id || '';
      const isIndex = !!node.index;

      const nodePath = isIndex
        ? currentPath || '/'
        : path
          ? `${currentPath}/${path}`
          : currentPath;

      if (elementId === targetKey) {
        matches.push(isIndex ? currentPath || '/' : nodePath || '/');
      }

      if (node.children) {
        walk(node.children, path ? `${currentPath}/${path}` : currentPath);
      }
    }
  }
  walk(routeTree, '');
  return matches;
}

function listAllRoutes(nodes, prefix = '') {
  for (const node of nodes) {
    const path = (node.path || '').replace(/^\/|\/$/g, '');
    const key = node.elementId || node.id || '';
    const isIndex = !!node.index;

    const displayPath = isIndex
      ? `${prefix} [index]`
      : path
        ? `${prefix}/${path}`
        : prefix || '/';

    if (key) {
      console.log(`  ${displayPath.padEnd(60)} → ${key}`);
    }
    if (node.children) {
      listAllRoutes(node.children, path ? `${prefix}/${path}` : prefix);
    }
  }
}

// --- Component Lookup in Registry ---

function findRegistryKeysForComponent(query, registry) {
  const normalized = query.replace(/^\/|\/$/g, '');
  const searchTerms = normalized.includes('/')
    ? [basename(normalized).replace(/\.tsx?$/, '')]
    : [normalized];

  const results = [];
  for (const [comp, entries] of Object.entries(registry)) {
    for (const term of searchTerms) {
      const tl = term.toLowerCase();
      const matchesKey = entries.some(
        (e) => tl === e.key.toLowerCase() || e.key.toLowerCase().includes(tl),
      );
      const matchesComp =
        tl === comp.toLowerCase() || comp.toLowerCase().includes(tl);
      if (matchesKey || matchesComp) {
        for (const entry of entries) {
          if (
            tl === entry.key.toLowerCase() ||
            tl === comp.toLowerCase() ||
            comp.toLowerCase().includes(tl) ||
            entry.key.toLowerCase().includes(tl)
          ) {
            results.push({
              key: entry.key,
              component: comp,
              package: entry.package,
              line: entry.line,
            });
          }
        }
        break;
      }
    }
  }
  return results;
}

function findRelatedRegistryKeys(pkg, registry) {
  const results = [];
  for (const [comp, entries] of Object.entries(registry)) {
    for (const entry of entries) {
      if (entry.package === pkg) {
        results.push({ key: entry.key, component: comp, package: pkg });
      }
    }
  }
  return results;
}

// --- ts-morph Tracing (lazy loaded) ---

async function traceComponent(componentName, repoRoot, mfeName, maxDepth) {
  let Project;
  try {
    ({ Project } = await import('ts-morph'));
  } catch {
    console.error('ERROR: ts-morph is not installed.');
    console.error('Run: npm install --prefix ~/.claude/skills/resolve-route');
    process.exit(EXIT_USAGE_ERROR);
  }
  const tsConfigPath = validatePath(
    join(repoRoot, 'tsconfig.base.json'),
    repoRoot,
  );
  if (!existsSync(tsConfigPath)) {
    console.error(`ERROR: tsconfig.base.json not found at ${tsConfigPath}`);
    process.exit(EXIT_USAGE_ERROR);
  }

  console.error('Loading TypeScript project...');
  const startTime = Date.now();
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: false,
  });
  console.error(
    `Project loaded in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${project.getSourceFiles().length} files)`,
  );

  const registry = parseRegistry(repoRoot).entries;
  const chain = [];
  let currentName = componentName;
  let currentMfe = mfeName;
  const visitedFiles = new Set();
  const alternateRegistered = [];

  for (let depth = 0; depth < maxDepth; depth++) {
    // Check registry before finding source file
    const regEntries = registry[currentName];
    if (regEntries) {
      const filtered = currentMfe
        ? regEntries.filter((r) => r.package.includes(currentMfe))
        : regEntries;
      if (filtered.length > 0) {
        chain.push({
          component: currentName,
          registered: filtered.map((r) => r.key),
          depth,
        });
        break;
      }
    }

    // Find source file (prefer non-barrel)
    const sourceFile = findSourceFile(project, currentName, currentMfe);
    if (!sourceFile) {
      chain.push({
        component: currentName,
        error: 'not found in project',
        depth,
      });
      break;
    }

    const absFilePath = sourceFile.getFilePath();
    if (visitedFiles.has(absFilePath)) {
      chain.push({ component: currentName, error: 'cycle detected', depth });
      break;
    }
    visitedFiles.add(absFilePath);

    const filePath = relative(repoRoot, absFilePath);
    const referencingFiles = getReferencingFiles(sourceFile, currentName);

    if (!referencingFiles.length) {
      chain.push({ component: currentName, file: filePath, usedBy: [], depth });
      break;
    }

    // Map referencing files to parent info
    const parents = referencingFiles
      .map((refPath) => {
        const refFile = project.getSourceFile(refPath);
        const primaryExport = refFile ? getPrimaryExport(refFile) : null;
        return {
          file: relative(repoRoot, refPath),
          component: primaryExport || basename(dirname(refPath)),
        };
      })
      .filter(
        (p) => !p.file.endsWith('index.ts') && !p.file.endsWith('index.tsx'),
      );

    const allParents = referencingFiles.map((refPath) => {
      const refFile = project.getSourceFile(refPath);
      const primaryExport = refFile ? getPrimaryExport(refFile) : null;
      return {
        file: relative(repoRoot, refPath),
        component: primaryExport || basename(dirname(refPath)),
      };
    });

    const usedBy = parents.length > 0 ? parents : allParents;

    chain.push({
      component: currentName,
      file: filePath,
      usedBy: usedBy.map((p) => ({
        component: p.component,
        file: p.file,
        registered: registry[p.component]
          ? registry[p.component].map((r) => r.key)
          : undefined,
      })),
      depth,
    });

    // Collect ALL registered parents (not just the one we follow)
    const candidates = usedBy.filter(
      (p) => p.component && p.component !== currentName,
    );
    for (const c of candidates) {
      if (
        registry[c.component] &&
        c !== candidates.find((p) => registry[p.component])
      ) {
        alternateRegistered.push({
          component: c.component,
          registryKeys: registry[c.component].map((r) => r.key),
          reachedFrom: currentName,
        });
      }
    }

    // Pick next parent: prefer registered, then screens, then first
    const registeredParent = candidates.find((p) => registry[p.component]);
    const screenParent = candidates.find(
      (p) => p.file.includes('/screens/') || p.file.includes('/pages/'),
    );
    const nextParent = registeredParent || screenParent || candidates[0];

    if (!nextParent) break;
    currentName = nextParent.component;
    const mfeMatch = nextParent.file.match(/libs\/(mfe-[^/]+)/);
    if (mfeMatch) currentMfe = mfeMatch[1];
  }

  const resolved =
    chain.length > 0 && chain[chain.length - 1].registered
      ? {
          registryKey: chain[chain.length - 1].registered,
          component: chain[chain.length - 1].component,
        }
      : null;

  return {
    query: componentName,
    chain,
    resolved,
    alternatePaths:
      alternateRegistered.length > 0 ? alternateRegistered : undefined,
  };
}

function findSourceFile(project, name, mfeName) {
  let barrelMatch = null;
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (
      /\/(spec|test|mock|__mocks__)\/|\.stories\.|\.cy\.|\.test\.|\.spec\./.test(
        filePath,
      )
    )
      continue;
    if (mfeName && !filePath.includes(`/libs/${mfeName}/`)) continue;
    if (!sourceFile.getExportedDeclarations().has(name)) continue;

    if (filePath.endsWith('/index.ts') || filePath.endsWith('/index.tsx')) {
      if (!barrelMatch) barrelMatch = sourceFile;
    } else {
      return sourceFile;
    }
  }
  return barrelMatch;
}

function getReferencingFiles(sourceFile, name) {
  const exported = sourceFile.getExportedDeclarations().get(name);
  if (!exported?.length) return [];

  try {
    const refs = exported[0].findReferences();
    const files = new Set();
    for (const ref of refs) {
      for (const entry of ref.getReferences()) {
        const refPath = entry.getSourceFile().getFilePath();
        if (refPath === sourceFile.getFilePath()) continue;
        if (
          /\/(spec|test|mock|__mocks__)\/|\.stories\.|\.cy\.|\.test\.|\.spec\./.test(
            refPath,
          )
        )
          continue;
        files.add(refPath);
      }
    }
    return [...files];
  } catch (err) {
    console.error(`Warning: findReferences failed for ${name}: ${err.message}`);
    return [];
  }
}

function getPrimaryExport(sourceFile) {
  const exports = sourceFile.getExportedDeclarations();
  for (const [name, decls] of exports) {
    if (name === 'default') continue;
    for (const decl of decls) {
      const kind = decl.getKindName();
      if (
        kind.includes('Function') ||
        kind.includes('Variable') ||
        kind.includes('Class')
      )
        return name;
    }
  }
  for (const [name] of exports) {
    if (name !== 'default') return name;
  }
  return null;
}

// --- Main ---

async function main() {
  // === FILE MODE → delegates to trace ===
  if (args.file) {
    const repoRoot = findRepoRoot();
    if (!repoRoot) {
      console.error(
        'ERROR: Cannot determine repo root. Pass --repo-root /path/to/ui-platform',
      );
      process.exit(EXIT_USAGE_ERROR);
    }

    const filePath = resolve(args.file);
    // Infer MFE from path
    const mfeMatch = filePath.match(/libs\/(mfe-[^/]+)/);
    const mfeName = args.mfe || (mfeMatch ? mfeMatch[1] : null);

    // Extract component name: use file stem (strip .component, .container, etc.)
    let componentName = basename(filePath)
      .replace(/\.tsx?$/, '')
      .split('.')[0];
    if (componentName === 'index') componentName = basename(dirname(filePath));
    // Convert kebab-case to PascalCase (e.g., motion-scan → MotionScan)
    if (componentName.includes('-')) {
      componentName = componentName
        .split('-')
        .map((s) => s[0]?.toUpperCase() + s.slice(1))
        .join('');
    }

    console.error(
      `Inferred: component=${componentName}, mfe=${mfeName || '(all)'}`,
    );

    // Delegate to trace
    args.trace = componentName;
    if (mfeName && !args.mfe) args.mfe = mfeName;
    // Fall through to trace mode below
  }

  // === TRACE MODE (ts-morph, ~8s) ===
  if (args.trace) {
    const repoRoot = findRepoRoot();
    if (!repoRoot) {
      console.error(
        'ERROR: Cannot determine repo root. Pass --repo-root /path/to/ui-platform',
      );
      process.exit(EXIT_USAGE_ERROR);
    }

    const result = await traceComponent(
      args.trace,
      repoRoot,
      args.mfe,
      parseInt(args.depth, 10) || 5,
    );
    console.log(JSON.stringify(result, null, 2));

    // Check route config for resolved + alternate paths
    const configFile = findConfigFile();
    if (configFile && (result.resolved || result.alternatePaths)) {
      const routeTree = loadRouteTree(configFile);

      if (result.resolved) {
        for (const key of result.resolved.registryKey) {
          const urls = findUrlsForRegistryKey(routeTree, key);
          if (urls.length) {
            console.log(`\nRoute (${key}): http://localhost:4200/#${urls[0]}`);
          } else {
            console.log(`\nRoute (${key}): NOT IN ROUTE CONFIG`);
          }
        }
      }

      if (result.alternatePaths) {
        console.log('\nAlternate paths:');
        for (const alt of result.alternatePaths) {
          for (const key of alt.registryKeys) {
            const urls = findUrlsForRegistryKey(routeTree, key);
            const route = urls.length
              ? `http://localhost:4200/#${urls[0]}`
              : 'NOT IN ROUTE CONFIG';
            console.log(`  - ${alt.component} (${key}) → ${route}`);
          }
        }
      }
    }
    process.exit(result.resolved ? EXIT_FOUND : EXIT_NOT_FOUND);
  }

  // === COMPONENT MODE (instant) ===
  if (args.component) {
    const repoRoot = findRepoRoot();
    if (!repoRoot) {
      console.error(
        'ERROR: Cannot determine repo root. Pass --repo-root /path/to/ui-platform',
      );
      process.exit(EXIT_USAGE_ERROR);
    }
    const { entries } = parseRegistry(repoRoot);
    const registryEntries = findRegistryKeysForComponent(
      args.component,
      entries,
    );

    if (!registryEntries.length) {
      console.log(`No registry entry found matching: ${args.component}`);
      console.log(`\nThis component is not directly in mainRegistry.tsx.`);
      console.log(
        `Use --trace ${args.component} to find its parent component chain.`,
      );
      process.exit(EXIT_NOT_FOUND);
    }

    const configFile = findConfigFile();
    if (!configFile) {
      console.error('ERROR: No cached embeddable configuration found.');
      console.error(
        'Run the client-hub skill to fetch: config type = Client Config, module = embeddable configuration',
      );
      process.exit(EXIT_USAGE_ERROR);
    }

    console.error(`Using: ${basename(configFile)}`);
    const routeTree = loadRouteTree(configFile);

    let anyFound = false;
    for (const entry of registryEntries) {
      console.log(`\nRegistry Key: ${entry.key}`);
      console.log(`Component: ${entry.component} from ${entry.package}`);
      console.log(`Registry Line: ${entry.line}`);

      const urls = findUrlsForRegistryKey(routeTree, entry.key);
      if (urls.length) {
        anyFound = true;
        console.log('URL(s):');
        for (const url of urls) console.log(`  http://localhost:4200/#${url}`);
      } else {
        console.log('URL(s): NOT IN ROUTE CONFIG');
        console.log(
          'Status: Registered in mainRegistry but no matching elementId in routeDefinition',
        );
        const related = findRelatedRegistryKeys(entry.package, entries);
        if (related.length) {
          console.log(`Related keys from ${entry.package}:`);
          for (const r of related) {
            const rUrls = findUrlsForRegistryKey(routeTree, r.key);
            console.log(
              `  - ${r.key} (${r.component}) → ${rUrls[0] || '(also not routed)'}`,
            );
          }
        }
      }
    }
    process.exit(anyFound ? EXIT_FOUND : EXIT_NOT_FOUND);
  }

  // === FORWARD / LIST-ROUTES MODE (instant) ===
  const configFile = findConfigFile();
  if (!configFile) {
    console.error('ERROR: No cached embeddable configuration found.');
    console.error(
      'Run the client-hub skill to fetch: config type = Client Config, module = embeddable configuration',
    );
    process.exit(EXIT_USAGE_ERROR);
  }

  console.error(`Using: ${basename(configFile)}`);
  const routeTree = loadRouteTree(configFile);

  if (args['list-routes']) {
    console.log('Available routes:');
    const rootChildren = routeTree[0]?.children || [];
    listAllRoutes(rootChildren);
    process.exit(EXIT_FOUND);
  }

  // Forward resolution
  const urlInput = args.url || args.path;
  if (!urlInput) {
    console.error(
      'ERROR: --path, --url, --component, or --trace required (or use --list-routes)',
    );
    process.exit(EXIT_USAGE_ERROR);
  }

  let pathStr = urlInput;
  if (pathStr.startsWith('http')) {
    const url = new URL(pathStr);
    pathStr = (url.hash || url.pathname).replace(/^#?\/?/, '');
  }
  pathStr = pathStr.replace(/^\/|\/$/g, '');
  const segments = pathStr.split('/').filter(Boolean);

  if (!segments.length) {
    console.error('ERROR: Empty path');
    process.exit(EXIT_USAGE_ERROR);
  }

  console.error(`Resolving: /${segments.join('/')}`);
  const rootChildren = routeTree[0]?.children || [];
  const result = findRoute(rootChildren, segments);

  if (!result) {
    console.log(`\nNo match found for: /${segments.join('/')}`);
    console.log('\nSearching for partial matches...');
    const searchTerm = segments[0];
    const matches = [];
    function search(nodes, target, currentPath = '') {
      for (const node of nodes) {
        const p = (node.path || '').replace(/^\/|\/$/g, '');
        const nodePath = p ? `${currentPath}/${p}` : currentPath;
        if (p.includes(target))
          matches.push({
            path: nodePath,
            key: node.elementId || node.id || '(no key)',
          });
        if (node.children) search(node.children, target, nodePath);
      }
    }
    search(routeTree, searchTerm);
    if (matches.length) {
      for (const m of matches) console.log(`  ${m.path} → ${m.key}`);
    } else {
      console.log(`  No nodes containing '${searchTerm}' found`);
    }
    process.exit(EXIT_NOT_FOUND);
  }

  const matchedNode = result.match;
  const registryKey = matchedNode.elementId || matchedNode.id || null;
  console.log(`\nRegistry Key: ${registryKey}`);

  // Show component name from registry
  const repoRoot = findRepoRoot();
  if (registryKey && repoRoot) {
    const { entries } = parseRegistry(repoRoot);
    const matched = findRegistryKeysForComponent(registryKey, entries);
    const exact = matched.find((e) => e.key === registryKey);
    if (exact) {
      console.log(`Component: ${exact.component} from ${exact.package}`);
    } else {
      console.log(`Component: (not in mainRegistry — may use defaultRegistry)`);
    }
  }

  const trailStr = result.trail
    .map(
      (n) =>
        n.elementId ||
        n.id ||
        (n.path || '?').replace(/^\/|\/$/g, '') ||
        '(layout)',
    )
    .join(' → ');
  console.log(`Route Trail: ${trailStr}`);

  // Show related keys
  if (registryKey && repoRoot) {
    const { entries } = parseRegistry(repoRoot);
    const matched = findRegistryKeysForComponent(registryKey, entries);
    if (matched.length) {
      const related = findRelatedRegistryKeys(matched[0].package, entries);
      if (related.length > 1) {
        console.log(`\nRelated registry keys from ${matched[0].package}:`);
        for (const r of related) {
          if (r.key !== registryKey) {
            const rUrls = findUrlsForRegistryKey(routeTree, r.key);
            console.log(
              `  - ${r.key} (${r.component}) → ${rUrls[0] || '(not in route config)'}`,
            );
          }
        }
      }
    }
  }

  if (args.verbose) {
    console.log('\nFull Node:');
    console.log(JSON.stringify(matchedNode, null, 2));
  }

  process.exit(EXIT_FOUND);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(EXIT_USAGE_ERROR);
});
