/**
 * The FHIR update (PUT) profile: it asks for the `u` scope letter with the `update` action, also
 * for a create through PUT, takes the identity from the URL id (`identify: 'url'`), replaces the
 * stored document with the body (`buildDocument: 'replace'`), and writes with the request's
 * `If-Match` and `If-None-Match` preconditions (`write: 'httpPreconditions'`). It turns no step
 * off.
 */
const UPDATE_WRITE_PROFILE = Object.freeze({
    name: 'update',
    accessRequested: 'u',
    action: 'update',
    variants: Object.freeze({
        identify: 'url',
        buildDocument: 'replace',
        write: 'httpPreconditions'
    })
});

module.exports = {
    UPDATE_WRITE_PROFILE
};
