/**
 * An existing test that the write pipeline switch-on run skips, because it fails only on one of
 * the spec's accepted differences.
 * @typedef {Object} WritePipelineSwitchOnExclusion
 * @property {string} testName The full test name as jest reports it: the `describe` names and the
 * test name, joined by spaces.
 * @property {string} reason The accepted difference the test asserts against, and the test that
 * covers the new behavior.
 */

/**
 * The existing tests the switch-on CI job skips. Empty until a test fails only because of an
 * accepted difference.
 * @type {WritePipelineSwitchOnExclusion[]}
 */
const writePipelineSwitchOnExclusions = [];

module.exports = {
    writePipelineSwitchOnExclusions
};
