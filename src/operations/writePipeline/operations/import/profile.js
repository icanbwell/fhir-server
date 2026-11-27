/**
 * The `$import` profile: it asks for the `u` scope letter with the `merge` action, as `$merge`
 * does, and turns off `validateAgainstStored`, which only a PUT runs, and `accessOnResult`,
 * because the access-tag change of an imported line is checked before the build. It sets
 * `itemErrorsFailItem`, so an error the scope check, the schema check, the meta check, the access
 * check or the build throws for a line fails only that line, as the old worker's per-line `try`
 * did, and not the whole flush.
 */
const IMPORT_WRITE_PROFILE = Object.freeze({
    name: 'import',
    accessRequested: 'u',
    action: 'merge',
    off: Object.freeze(['validateAgainstStored', 'accessOnResult']),
    itemErrorsFailItem: true
});

module.exports = {
    IMPORT_WRITE_PROFILE
};
