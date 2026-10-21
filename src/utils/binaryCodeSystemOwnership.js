const { ReferenceParser } = require('./referenceParser');

/**
 * Non-enumerable key marking a CodeSystem property with the CodeSystem that owns it
 * (see graphql/resolvers/custom/codeSystem.js).
 * @type {symbol}
 */
const CODE_SYSTEM_OWNER = Symbol('codeSystemOwner');

/**
 * Whether a Binary reached through a CodeSystem property (GraphQL v1
 * CodeSystem.concept.property.valueString = 'Binary/<id>') may be returned.
 *
 * A CodeSystem-owned Binary belongs to no patient, so it carries either no securityContext or one
 * pointing at that exact CodeSystem. Anything else (a Patient, another CodeSystem) means the Binary
 * belongs to someone else and must not be exposed through this path.
 *
 * Every form the reference can take (reference, _sourceId, _uuid) must agree.
 *
 * @param {{securityContext?: {reference?: string, _sourceId?: string, _uuid?: string}}|null} binary
 * @param {{id?: string, _uuid?: string, _sourceId?: string}} codeSystem the parent CodeSystem
 * @return {boolean}
 */
function isBinaryReadableViaCodeSystem ({ binary, codeSystem }) {
    if (!binary) {
        return false;
    }
    const securityContext = binary.securityContext;
    const references = [securityContext?.reference, securityContext?._sourceId, securityContext?._uuid]
        .filter(reference => typeof reference === 'string' && reference.length > 0);
    if (references.length === 0) {
        return true;
    }
    const codeSystemIds = new Set(
        [codeSystem?.id, codeSystem?._uuid, codeSystem?._sourceId]
            .filter(id => typeof id === 'string' && id.length > 0)
            .map(id => ReferenceParser.parseReference(id).id)
    );
    return references.every(reference => {
        const { resourceType, id } = ReferenceParser.parseReference(reference);
        return resourceType === 'CodeSystem' && codeSystemIds.has(id);
    });
}

/**
 * Marks every property under the given concepts (recursively) with the CodeSystem that owns it, so a
 * property's valueString resolver can check that a referenced Binary belongs to this CodeSystem. The
 * mark is non-enumerable so it never reaches serialization.
 * @param {Object[]|undefined} concepts
 * @param {{id?: string, _uuid?: string, _sourceId?: string}} codeSystem
 * @return {Object[]|undefined} the same concepts
 */
function markCodeSystemProperties (concepts, codeSystem) {
    if (!Array.isArray(concepts)) {
        return concepts;
    }
    const owner = { id: codeSystem?.id, _uuid: codeSystem?._uuid, _sourceId: codeSystem?._sourceId };
    const mark = (list) => {
        for (const concept of list) {
            if (!concept) {
                continue;
            }
            for (const property of concept.property || []) {
                if (property) {
                    Object.defineProperty(property, CODE_SYSTEM_OWNER, { value: owner, enumerable: false });
                }
            }
            if (Array.isArray(concept.concept)) {
                mark(concept.concept);
            }
        }
    };
    mark(concepts);
    return concepts;
}

/**
 * Removes the patient/ scopes from a scope string, matching ScopesManager.hasPatientScope's
 * case-insensitive prefix test so the result can never still count as patient-scoped.
 * @param {string|undefined} scope
 * @return {string}
 */
function removePatientScopes (scope) {
    if (!scope) {
        return '';
    }
    return scope
        .split(' ')
        .filter(s => s && !s.toLowerCase().startsWith('patient/'))
        .join(' ');
}

module.exports = {
    CODE_SYSTEM_OWNER,
    isBinaryReadableViaCodeSystem,
    markCodeSystemProperties,
    removePatientScopes
};
