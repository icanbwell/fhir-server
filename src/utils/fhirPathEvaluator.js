const fhirpath = require('fhirpath');
const fhirpathR4Model = require('fhirpath/fhir-context/r4');

/**
 * Parses a FHIR reference string like "Organization/o1" or a full URL into its logical id.
 * @param {string} reference
 * @returns {{ resourceType: string|undefined, id: string }|undefined}
 */
function parseReference(reference) {
    if (!reference || typeof reference !== 'string') {
        return undefined;
    }
    const parts = reference.split('/');
    if (parts.length < 2) {
        return { resourceType: undefined, id: reference };
    }
    const id = parts[parts.length - 1];
    const resourceType = parts[parts.length - 2];
    return { resourceType, id };
}

/**
 * Unwraps a fhirpath ResourceNode (or plain value) to its underlying data.
 * @param {*} node
 * @returns {*}
 */
function unwrap(node) {
    return node && typeof node === 'object' && 'data' in node && node.data !== undefined
        ? node.data
        : node;
}

/**
 * SQL-on-FHIR helper functions registered into the fhirpath userInvocationTable.
 * See https://build.fhir.org/ig/FHIR/sql-on-fhir-v2/#getResourceKey
 */
const sqlOnFhirFunctions = {
    getResourceKey: {
        fn: (nodes) =>
            nodes
                .map((n) => unwrap(n))
                .map((v) => (v && v.id !== undefined ? v.id : v))
                .filter((v) => v !== undefined),
        arity: { 0: [] }
    },
    getReferenceKey: {
        fn: (nodes, resourceTypeNode) => {
            const wantedType = Array.isArray(resourceTypeNode)
                ? resourceTypeNode[0]
                : resourceTypeNode;
            const out = [];
            for (const n of nodes) {
                const v = unwrap(n);
                const ref = v && typeof v === 'object' ? v.reference : v;
                const parsed = parseReference(ref);
                if (!parsed) {
                    continue;
                }
                if (wantedType && parsed.resourceType && parsed.resourceType !== wantedType) {
                    continue;
                }
                out.push(parsed.id);
            }
            return out;
        },
        arity: { 0: [], 1: ['String'] }
    }
};

class FhirPathEvaluator {
    constructor() {
        this.options = { userInvocationTable: sqlOnFhirFunctions };
    }

    /**
     * @param {{ node: Object, expression: string, variables?: Object }} params
     * @returns {any[]} FHIRPath result, always an array (possibly empty)
     */
    evaluate({ node, expression, variables = {} }) {
        const result = fhirpath.evaluate(
            node,
            expression,
            variables,
            fhirpathR4Model,
            this.options
        );
        return Array.isArray(result) ? result : [result];
    }
}

module.exports = { FhirPathEvaluator };
