const { BadRequestError } = require('../../utils/httpErrors');

class ViewDefinitionValidator {
    /**
     * Structurally validates a ViewDefinition (plain object or resource instance),
     * throwing on the first problem found. Fail-fast, no partial results.
     * @param {Object} view a ViewDefinition (plain object or resource instance)
     * @throws {BadRequestError}
     */
    validate(view) {
        if (!view || typeof view !== 'object') {
            throw new BadRequestError(new Error('ViewDefinition is required'));
        }
        if (!view.resource || typeof view.resource !== 'string') {
            throw new BadRequestError(
                new Error('ViewDefinition.resource (a FHIR resource type) is required')
            );
        }
        if (!Array.isArray(view.select) || view.select.length === 0) {
            throw new BadRequestError(new Error('ViewDefinition.select must be a non-empty array'));
        }
        const seen = new Set();
        this._walkSelections(view.select, seen);
    }

    /**
     * Recursively walks select entries, validating columns and tracking column
     * name uniqueness via the shared `seen` set.
     * @param {Array} selections
     * @param {Set<string>} seen column names already used by this branch's ancestors
     */
    _walkSelections(selections, seen) {
        for (const selection of selections) {
            for (const col of selection.column || []) {
                if (!col.name || typeof col.name !== 'string') {
                    throw new BadRequestError(
                        new Error('Each ViewDefinition column requires a non-empty name')
                    );
                }
                if (!col.path || typeof col.path !== 'string') {
                    throw new BadRequestError(
                        new Error(`Column "${col.name}" requires a non-empty path`)
                    );
                }
                if (seen.has(col.name)) {
                    throw new BadRequestError(new Error(`Duplicate column name "${col.name}"`));
                }
                seen.add(col.name);
            }
            if (Array.isArray(selection.select)) {
                this._walkSelections(selection.select, seen);
            }
            if (Array.isArray(selection.unionAll)) {
                // unionAll branches legitimately share column names with each other (they're
                // alternative rows for the same output columns), so each branch is validated
                // against its own fresh copy of the seen-set. A duplicate within one branch
                // (or against the branch's own ancestors) is still an error; siblings reusing
                // the same names is not.
                for (const branch of selection.unionAll) {
                    this._walkSelections([branch], new Set(seen));
                }
            }
            if (Array.isArray(selection.forEach)) {
                this._walkSelections(selection.forEach, seen);
            }
        }
    }
}

module.exports = { ViewDefinitionValidator };
