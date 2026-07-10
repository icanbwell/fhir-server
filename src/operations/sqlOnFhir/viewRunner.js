/**
 * Streaming port of medplum's evalSqlOnFhir (packages/core/src/sql-on-fhir/eval.ts).
 * Yields one plain row object at a time instead of materializing OutputRow[].
 */

/**
 * Collects a ViewDefinition's `constant` entries into a %variables map for FHIRPath.
 * @param {Object} view ViewDefinition-shaped object
 * @returns {Object} map of constant name -> value
 */
function buildConstants(view) {
    const variables = {};
    for (const c of view.constant || []) {
        // constant value is stored as value[x]; take the first defined value* key
        const valueKey = Object.keys(c).find((k) => k.startsWith('value'));
        variables[c.name] = valueKey ? c[valueKey] : undefined;
    }
    return variables;
}

/**
 * Evaluates a single column's path against a focus node, enforcing the
 * collection/singleton contract (D1: a non-collection column that yields >1 value throws).
 * @returns {*} scalar, array (collection:true), or null
 */
function columnValue(col, focus, variables, fhirPathEvaluator) {
    const result = fhirPathEvaluator.evaluate({ node: focus, expression: col.path, variables });
    if (col.collection) {
        return result;
    }
    if (result.length > 1) {
        throw new Error(
            `Column "${col.name}" returned multiple values but is not marked collection:true; ` +
                'expected a single value.'
        );
    }
    return result.length === 1 ? result[0] : null;
}

/**
 * Cartesian product of row-fragment groups.
 * @param {Array<Array<Object>>} parts each part is a list of candidate partial rows
 * @returns {Array<Object>} merged rows (one field-merged object per combination)
 */
function cartesian(parts) {
    return parts.reduce(
        (acc, part) => {
            const next = [];
            for (const a of acc) {
                for (const b of part) {
                    next.push({ ...a, ...b });
                }
            }
            return next;
        },
        [{}]
    );
}

/**
 * Expands one selection into its rows: determine foci (forEach/forEachOrNull/self),
 * then for each focus take the cartesian product of this selection's columns, its
 * nested selects, and its unionAll branches.
 * @returns {Array<Object>} rows contributed by this selection
 */
function processSelection(selection, node, variables, fhirPathEvaluator) {
    let foci;
    if (selection.forEach) {
        foci = fhirPathEvaluator.evaluate({ node, expression: selection.forEach, variables });
    } else if (selection.forEachOrNull) {
        foci = fhirPathEvaluator.evaluate({ node, expression: selection.forEachOrNull, variables });
    } else {
        foci = [node];
    }

    if (foci.length === 0 && selection.forEachOrNull) {
        // emit a single row with nulls for this selection's own columns
        const nullRow = {};
        for (const col of selection.column || []) {
            nullRow[col.name] = col.collection ? [] : null;
        }
        return [nullRow];
    }

    const rows = [];
    for (const focus of foci) {
        const parts = [];

        if (selection.column && selection.column.length > 0) {
            const colRow = {};
            for (const col of selection.column) {
                colRow[col.name] = columnValue(col, focus, variables, fhirPathEvaluator);
            }
            parts.push([colRow]);
        }

        for (const nested of selection.select || []) {
            parts.push(processSelection(nested, focus, variables, fhirPathEvaluator));
        }

        if (Array.isArray(selection.unionAll) && selection.unionAll.length > 0) {
            const unionRows = [];
            for (const branch of selection.unionAll) {
                unionRows.push(...processSelection(branch, focus, variables, fhirPathEvaluator));
            }
            parts.push(unionRows);
        }

        rows.push(...cartesian(parts));
    }
    return rows;
}

/**
 * Streams the rows produced by evaluating a ViewDefinition over a resource iterable.
 * @param {Object} view ViewDefinition-shaped object
 * @param {AsyncIterable<Object>|Iterable<Object>} resourceIterable
 * @param {{ fhirPathEvaluator: import('../../utils/fhirPathEvaluator').FhirPathEvaluator }} deps
 * @returns {AsyncGenerator<Object>} rows
 */
async function* runView(view, resourceIterable, { fhirPathEvaluator }) {
    const variables = buildConstants(view);
    for await (const resource of resourceIterable) {
        // resource-type gate: a ViewDefinition only applies to resources of its
        // declared type. Inputs of any other type are silently skipped (mirrors
        // medplum's evalSqlOnFhir, which filters by resourceType before evaluating).
        if (view.resource && resource && resource.resourceType !== view.resource) {
            continue;
        }
        // where gate: every clause must evaluate to a single boolean true
        let included = true;
        for (const clause of view.where || []) {
            const r = fhirPathEvaluator.evaluate({
                node: resource,
                expression: clause.path,
                variables
            });
            if (!(r.length === 1 && r[0] === true)) {
                included = false;
                break;
            }
        }
        if (!included) {
            continue;
        }
        const topRows = cartesian(
            (view.select || []).map((s) =>
                processSelection(s, resource, variables, fhirPathEvaluator)
            )
        );
        for (const row of topRows) {
            yield row;
        }
    }
}

module.exports = { runView };
