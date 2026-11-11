const baseConfig = require('./jest.config');
const { writePipelineSwitchOnExclusions } = require('./src/tests/writePipelineSwitchOnExclusions');

/**
 * Escapes a test name so it matches itself literally inside a regular expression.
 * @param {string} text
 * @returns {string}
 */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Returns a `testNamePattern` that matches every test name except the excluded ones.
 * @param {import('./src/tests/writePipelineSwitchOnExclusions').WritePipelineSwitchOnExclusion[]} exclusions
 * @returns {string}
 */
const patternExcluding = (exclusions) =>
    `^(?!(${exclusions.map(({ testName }) => escapeRegExp(testName)).join('|')})$).*`;

/**
 * Jest config for the write pipeline switch-on CI job: the integration suite of `jest.config.js`,
 * minus the tests in `writePipelineSwitchOnExclusions`. The job turns the new path on by setting
 * `WRITE_PIPELINE_OPERATIONS`.
 * @type {import('jest').Config}
 */
module.exports = writePipelineSwitchOnExclusions.length === 0
    ? baseConfig
    : { ...baseConfig, testNamePattern: patternExcluding(writePipelineSwitchOnExclusions) };
