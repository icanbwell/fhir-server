/**
 * The FHIR update (PUT) profile: it asks for the `u` scope letter with the `update` action, also
 * for a create through PUT, takes the identity from the URL id (`identify: 'url'`), replaces the
 * stored document with the body (`buildDocument: 'replace'`), validates the body against the stored
 * document in the `validateAgainstStored` step before the build, so the result check of an update
 * is the meta check only (`validateResult: 'update'`), and writes with the request's `If-Match` and
 * `If-None-Match` preconditions (`write: 'httpPreconditions'`). It turns off `accessOnResult`,
 * because the access-tag change of a PUT is checked before the build, and it is the only profile
 * that runs `validateAgainstStored`.
 */
const UPDATE_WRITE_PROFILE = Object.freeze({
    name: 'update',
    accessRequested: 'u',
    action: 'update',
    variants: Object.freeze({
        identify: 'url',
        buildDocument: 'replace',
        validateResult: 'update',
        write: 'httpPreconditions'
    }),
    off: Object.freeze(['accessOnResult'])
});

module.exports = {
    UPDATE_WRITE_PROFILE
};
