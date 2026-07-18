const fhirpath = require('fhirpath');
const fhirpathR4Model = require('fhirpath/fhir-context/r4');

// fhirpath monkey-patches String.prototype with *enumerable* `hashCode` and `seed`.
// Enumerable properties on String.prototype leak into every `for...in` over a string,
// including Express's res.set/res.header, which then tries to emit them as HTTP headers
// and throws "Invalid character in header content" — 500ing all FHIR write responses.
// Make them non-enumerable while keeping fhirpath's functionality intact.
for (const prop of ['hashCode', 'seed']) {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, prop);
    if (descriptor && descriptor.enumerable) {
        Object.defineProperty(String.prototype, prop, { ...descriptor, enumerable: false });
    }
}

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
            let wantedType = Array.isArray(resourceTypeNode)
                ? resourceTypeNode[0]
                : resourceTypeNode;
            // The type specifier is a FHIRPath identifier (e.g. getReferenceKey(Patient)).
            // With `Identifier` arity, fhirpath.js hands us the raw source text of the
            // argument node, so a quoted string literal arrives with its quotes intact
            // (e.g. "'Patient'"). Strip surrounding quotes so both the identifier and
            // string-literal forms resolve to the same bare type name.
            if (typeof wantedType === 'string') {
                wantedType = wantedType.replace(/^(['"])(.*)\1$/, '$2');
            }
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
        arity: { 0: [], 1: ['Identifier'] }
    }
};

/**
 * Rewrites a bare root-level `$this` token to `%context`.
 *
 * The npm `fhirpath` engine does not bind `ctx.$this` at the root of an evaluation,
 * so a root-level `$this` throws (and `$this.foo` silently returns empty), even though
 * the FHIRPath spec defines the root `$this` to be identical to the input focus (which
 * the engine *does* expose as `%context`). SQL-on-FHIR views routinely use `$this` as a
 * column path when iterating a primitive collection via `forEach` (e.g. `forEach:
 * name.given`, `column path: $this`), so we normalize it here.
 *
 * Crucially, fhirpath.js DOES correctly bind `$this` natively inside macro
 * sub-expressions such as `where(...)`, `select(...)`, `exists(...)`, `all(...)`, and
 * `iif(...)` — there it refers to the item currently being iterated, not the evaluation
 * root. Rewriting those nested occurrences to `%context` would silently replace the
 * per-item focus with the root node, producing wrong (but not erroring) results. To
 * avoid that, only tokens at parenthesis depth 0 (i.e. not lexically inside any `(...)`)
 * are rewritten.
 *
 * The substitution only touches `$this` tokens outside of quoted string literals so it
 * cannot corrupt a literal that happens to contain the text `$this`, and parens inside
 * string literals do not affect the depth count either.
 * @param {string} expression
 * @returns {string}
 */
function normalizeThis(expression) {
    if (typeof expression !== 'string' || !expression.includes('$this')) {
        return expression;
    }
    let out = '';
    let quote = null; // active string-literal delimiter, or null
    let depth = 0; // parenthesis nesting depth outside of string literals
    for (let i = 0; i < expression.length; i++) {
        const ch = expression[i];
        if (quote) {
            out += ch;
            if (ch === '\\' && i + 1 < expression.length) {
                // preserve escaped character verbatim
                out += expression[++i];
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
            out += ch;
            continue;
        }
        if (ch === '(') {
            depth++;
            out += ch;
            continue;
        }
        if (ch === ')') {
            depth--;
            out += ch;
            continue;
        }
        if (
            depth === 0 &&
            expression.startsWith('$this', i) &&
            !/[A-Za-z0-9_]/.test(expression[i + 5] || '')
        ) {
            out += '%context';
            i += 4; // skip the remaining chars of "$this"
            continue;
        }
        out += ch;
    }
    return out;
}

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
            normalizeThis(expression),
            variables,
            fhirpathR4Model,
            this.options
        );
        return Array.isArray(result) ? result : [result];
    }
}

module.exports = { FhirPathEvaluator };
