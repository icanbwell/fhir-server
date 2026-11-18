/**
 * The FHIR create (POST) profile: it asks for the `c` scope letter with the `create` action, runs
 * the `insert` variant of `buildDocument`, runs the shared `validateIncoming`,
 * `validateNewResource` and `validateResult` steps as `$merge` does, and turns off `findExisting`,
 * because a POST has no stored document to load, `validateAgainstStored`, which only a PUT runs,
 * and `noOpCheck`.
 */
const CREATE_WRITE_PROFILE = Object.freeze({
    name: 'create',
    accessRequested: 'c',
    action: 'create',
    variants: Object.freeze({
        buildDocument: 'insert'
    }),
    off: Object.freeze(['findExisting', 'validateAgainstStored', 'noOpCheck'])
});

module.exports = {
    CREATE_WRITE_PROFILE
};
