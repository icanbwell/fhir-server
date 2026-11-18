/**
 * The `$merge` profile: it asks for the `u` scope letter with the `merge` action and turns off
 * `validateAgainstStored`, which only a PUT runs.
 */
const MERGE_WRITE_PROFILE = Object.freeze({
    name: 'merge',
    accessRequested: 'u',
    action: 'merge',
    off: Object.freeze(['validateAgainstStored'])
});

module.exports = {
    MERGE_WRITE_PROFILE
};
