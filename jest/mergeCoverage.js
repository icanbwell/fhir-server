/**
 * Merges the `coverage-final.json` files that the CI test jobs upload, one per integration shard
 * and one for the unit tests, into one coverage report: HTML, lcov, merged JSON and a JSON summary
 * in the output directory, a text summary on stdout, and, when run in GitHub Actions, a markdown
 * table of the totals and of each folder in the job summary.
 *
 * Usage: node jest/mergeCoverage.js <directory with coverage-final.json files> <output directory>
 */
const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

/**
 * The name of the file jest's `json` coverage reporter writes.
 */
const COVERAGE_FILE_NAME = 'coverage-final.json';

/**
 * How many path segments, counted from the repo root, name the folder a file is summarized under,
 * for example `src/operations/merge`.
 */
const FOLDER_DEPTH = 3;

/**
 * The coverage metrics, in the order the summary shows them.
 */
const METRICS = Object.freeze(['statements', 'branches', 'functions', 'lines']);

/**
 * The reports written to the output directory, plus `text-summary`, which prints to stdout.
 */
const REPORTERS = Object.freeze(['html', 'lcovonly', 'json', 'json-summary', 'text-summary']);

/**
 * Returns the path of every coverage file under the given directory, sorted.
 * @param {string} directory
 * @returns {string[]}
 */
const findCoverageFiles = (directory) =>
    fs
        .readdirSync(directory, { recursive: true })
        .filter((relativePath) => path.basename(relativePath) === COVERAGE_FILE_NAME)
        .map((relativePath) => path.join(directory, relativePath))
        .sort();

/**
 * Merges the given coverage files into one coverage map. A statement, branch or function counts
 * as covered when any of the files covers it.
 * @param {string[]} files
 * @returns {import('istanbul-lib-coverage').CoverageMap}
 */
const mergeCoverageFiles = (files) => {
    const coverageMap = libCoverage.createCoverageMap({});
    for (const file of files) {
        coverageMap.merge(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    return coverageMap;
};

/**
 * Returns the coverage summary of each folder, keyed by the folder's path from the root directory
 * cut to `FOLDER_DEPTH` segments, sorted by that path.
 * @param {import('istanbul-lib-coverage').CoverageMap} coverageMap
 * @param {string} rootDirectory
 * @returns {Map<string, import('istanbul-lib-coverage').CoverageSummary>}
 */
const summarizeByFolder = (coverageMap, rootDirectory) => {
    const summaries = new Map();
    for (const file of coverageMap.files()) {
        const segments = path.relative(rootDirectory, file).split(path.sep);
        const folder = segments.slice(0, Math.min(FOLDER_DEPTH, segments.length - 1)).join('/');
        if (!summaries.has(folder)) {
            summaries.set(folder, libCoverage.createCoverageSummary());
        }
        summaries.get(folder).merge(coverageMap.fileCoverageFor(file).toSummary());
    }
    return new Map([...summaries].sort(([a], [b]) => a.localeCompare(b)));
};

/**
 * Formats one metric of a summary as `<percent>% (<covered>/<total>)`, or `-` when there is
 * nothing to cover.
 * @param {{covered: number, total: number, pct: number}} metric
 * @returns {string}
 */
const formatMetric = ({ covered, total, pct }) => (total === 0 ? '-' : `${pct}% (${covered}/${total})`);

/**
 * Returns one markdown table row with each metric of the summary.
 * @param {string} name
 * @param {import('istanbul-lib-coverage').CoverageSummary} summary
 * @returns {string}
 */
const toMarkdownRow = (name, summary) => `| ${name} | ${METRICS.map((metric) => formatMetric(summary[metric])).join(' | ')} |`;

/**
 * Returns the job summary markdown: the totals, then each folder in a collapsed table.
 * @param {import('istanbul-lib-coverage').CoverageMap} coverageMap
 * @param {Map<string, import('istanbul-lib-coverage').CoverageSummary>} folderSummaries
 * @param {number} coverageFileCount
 * @returns {string}
 */
const toMarkdown = (coverageMap, folderSummaries, coverageFileCount) => {
    const header = (firstColumn) => [`| ${firstColumn} | Statements | Branches | Functions | Lines |`, '|---|---|---|---|---|'];
    return [
        '## Test coverage',
        '',
        `Integration and unit tests combined, merged from ${coverageFileCount} coverage files. ` +
            'Source files that no test loads count as 0%. The full report is the `coverage-report` artifact of this run.',
        '',
        ...header(''),
        toMarkdownRow('**All files**', coverageMap.getCoverageSummary()),
        '',
        '<details><summary>By folder</summary>',
        '',
        ...header('Folder'),
        ...[...folderSummaries].map(([folder, summary]) => toMarkdownRow(`\`${folder}\``, summary)),
        '',
        '</details>',
        ''
    ].join('\n');
};

/**
 * Reads the input and output directories from the command line, merges the coverage files and
 * writes the reports.
 */
const main = () => {
    const [inputDirectory, outputDirectory] = process.argv.slice(2);
    if (!inputDirectory || !outputDirectory) {
        console.error('Usage: node jest/mergeCoverage.js <input directory> <output directory>');
        process.exit(1);
    }
    const coverageFiles = findCoverageFiles(inputDirectory);
    if (coverageFiles.length === 0) {
        console.error(`No ${COVERAGE_FILE_NAME} files under ${inputDirectory}`);
        process.exit(1);
    }
    const coverageMap = mergeCoverageFiles(coverageFiles);
    const context = libReport.createContext({ dir: outputDirectory, coverageMap, defaultSummarizer: 'nested' });
    for (const reporter of REPORTERS) {
        reports.create(reporter).execute(context);
    }
    console.log(`Merged ${coverageFiles.length} coverage files into ${outputDirectory}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        const folderSummaries = summarizeByFolder(coverageMap, process.cwd());
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, toMarkdown(coverageMap, folderSummaries, coverageFiles.length));
    }
};

main();
