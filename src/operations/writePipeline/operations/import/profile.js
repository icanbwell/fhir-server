/**
 * The `$import` profile: it asks for the `u` scope letter with the `merge` action, as `$merge`
 * does, and turns off `validateAgainstStored`, which only a PUT runs, and `accessOnResult`,
 * because the access-tag change of an imported line is checked before the build.
 */
const IMPORT_WRITE_PROFILE = Object.freeze({
    name: 'import',
    accessRequested: 'u',
    action: 'merge',
    off: Object.freeze(['validateAgainstStored', 'accessOnResult'])
});

module.exports = {
    IMPORT_WRITE_PROFILE
};
