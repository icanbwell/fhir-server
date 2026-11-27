/**
 * The FHIR patch (PATCH) profile: it asks for the `u` scope letter with the `patch` action. The
 * body is a JSON Patch, not a resource, so it turns off the steps that read a resource body
 * (`identify`, `prepareBody`, `validateIncoming`, `validateNewResource`) and the one that compares
 * a body with the stored document (`validateAgainstStored`). It finds the stored document through
 * the access-filtered search (`findExisting: 'search'`), checks that the caller may update it
 * (`accessBeforeBuild: 'stored'`), applies the patch to it (`buildDocument: 'patch'`), always
 * stores a fresh live base64 object (`attachments: 'alwaysCreateNew'`) and writes by `_uuid` alone
 * (`write: 'patch'`). The result check and the access-tag change check of the shared steps run
 * unchanged.
 */
const PATCH_WRITE_PROFILE = Object.freeze({
    name: 'patch',
    accessRequested: 'u',
    action: 'patch',
    off: Object.freeze([
        'identify',
        'prepareBody',
        'validateIncoming',
        'validateNewResource',
        'validateAgainstStored'
    ]),
    variants: Object.freeze({
        findExisting: 'search',
        accessBeforeBuild: 'stored',
        buildDocument: 'patch',
        attachments: 'alwaysCreateNew',
        write: 'patch'
    })
});

module.exports = {
    PATCH_WRITE_PROFILE
};
