/**
 * The `$merge` profile: it asks for the `u` scope letter with the `merge` action and turns no step
 * off.
 */
const MERGE_WRITE_PROFILE = Object.freeze({
    name: 'merge',
    accessRequested: 'u',
    action: 'merge'
});

module.exports = {
    MERGE_WRITE_PROFILE
};
