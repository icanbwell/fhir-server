const { BadRequestError } = require('../../../utils/httpErrors');
const { BaseFilter } = require('./baseFilter');
const { FilterParameters } = require('./filterParameters');
const { FieldMapper } = require('./fieldMapper');
const { QueryParameterValue } = require('../queryParameterValue');
const { ParsedArgsItem } = require('../parsedArgsItem');
const { fhirFilterTypes } = require('../customQueries');
const { FilterByToken } = require('./token');
const { FilterByQuantity } = require('./quantity');
const { FilterByDateTime } = require('./dateTime');
const { FilterByString } = require('./string');
const { FilterByReference } = require('./reference');
const { FilterByNumber } = require('./number');

const REJECTED_MODIFIERS = ['missing', 'contains', 'above', 'below', 'text', 'of-type'];

const FILTER_CLASS_BY_TYPE = {
    [fhirFilterTypes.token]: FilterByToken,
    [fhirFilterTypes.quantity]: FilterByQuantity,
    [fhirFilterTypes.date]: FilterByDateTime,
    [fhirFilterTypes.datetime]: FilterByDateTime,
    [fhirFilterTypes.instant]: FilterByDateTime,
    [fhirFilterTypes.period]: FilterByDateTime,
    [fhirFilterTypes.string]: FilterByString,
    [fhirFilterTypes.reference]: FilterByReference,
    [fhirFilterTypes.number]: FilterByNumber
};

/**
 * @classdesc Filters by composite FHIR search parameters (type: 'composite').
 * https://www.hl7.org/fhir/search.html#composite
 *
 * A composite value is N '$'-separated parts, one per component of the *matching* scope (a
 * composite may declare more than one scope via its own '|'-joined expression, e.g.
 * 'Observation | Observation.component' for combo-*; every scope has the same component count,
 * so the value's '$' part count is checked against propertyObj.scopes[0].components.length).
 * Each part is filtered using the existing per-type filter class for that component (reusing
 * FilterByToken/FilterByQuantity/FilterByDateTime/FilterByString/FilterByReference exactly as
 * r4.js's own type switch does, via each class's public .filter() method) against a synthetic
 * single-component, single-value FilterParameters. Components sharing an array scope
 * (arrayField set) are combined into one $elemMatch per array field (never one $elemMatch per
 * component -- that would let each component match a *different* array element). Root-scoped
 * components are ANDed at the top level. Scopes are OR'd together.
 */
class FilterByComposite extends BaseFilter {
    filter() {
        const modifiers = this.parsedArg.modifiers || [];
        if (REJECTED_MODIFIERS.some((m) => modifiers.includes(m))) {
            throw new BadRequestError(
                new Error(
                    `Modifiers [${REJECTED_MODIFIERS.join(', ')}] are not supported on composite search ` +
                        `parameters (got: ${modifiers.join(', ')})`
                )
            );
        }
        if (modifiers.includes('exact')) {
            throw new BadRequestError(
                new Error("Modifier 'exact' is not supported on composite search parameters")
            );
        }

        const values = this.parsedArg.queryParameterValue.values || [];
        const operator = this.parsedArg.queryParameterValue.operator;
        const perValueConditions = values.map((value) => this.filterOneValue(value));
        if (perValueConditions.length === 0) {
            return [];
        }
        return [{ [operator]: perValueConditions }];
    }

    /**
     * @param {string} value one '$'-joined composite value, e.g. '8480-6$ge140'
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterOneValue(value) {
        const parts = value.split('$');
        if (parts.some((p) => !p || !p.trim())) {
            throw new BadRequestError(
                new Error(
                    `Composite search parameter value '${value}' has an empty component value -- ` +
                        "every '$'-separated part must be non-empty"
                )
            );
        }
        const scopeConditions = this.propertyObj.scopes.map((scope) => {
            if (parts.length !== scope.components.length) {
                throw new BadRequestError(
                    new Error(
                        `Composite search parameter value '${value}' has ${parts.length} '$'-separated ` +
                            `part(s) but this parameter has ${scope.components.length} component(s)`
                    )
                );
            }
            return this.filterOneScope(scope, parts);
        });
        return scopeConditions.length > 1 ? { $or: scopeConditions } : scopeConditions[0];
    }

    /**
     * @param {{components: SearchParameterDefinition[]}} scope
     * @param {string[]} parts
     */
    filterOneScope(scope, parts) {
        const rootSegments = [];
        const segmentsByArrayField = new Map();

        scope.components.forEach((component, i) => {
            const segments = this.filterOneComponent(component, parts[i]);
            // belt-and-suspenders: filterOneValue already rejects empty/whitespace-only parts,
            // so a non-empty value reaching here should always produce at least one segment. If
            // some future filter class silently no-ops on a value it can't handle instead of
            // throwing, fail loudly here rather than let filterOneScope quietly drop this
            // component's constraint from the AND (which would widen the query instead of
            // rejecting the request).
            if (segments.length === 0) {
                throw new BadRequestError(
                    new Error(
                        `Composite component (field=${component.firstField}, type=${component.type}) ` +
                            `produced no filter for value '${parts[i]}'`
                    )
                );
            }
            if (component.arrayField) {
                if (!segmentsByArrayField.has(component.arrayField)) {
                    segmentsByArrayField.set(component.arrayField, []);
                }
                segmentsByArrayField.get(component.arrayField).push(...segments);
            } else {
                rootSegments.push(...segments);
            }
        });

        const conditions = [...rootSegments];
        for (const [arrayField, segments] of segmentsByArrayField) {
            conditions.push({
                [this.fieldMapper.getFieldName(arrayField)]: {
                    $elemMatch: segments.length > 1 ? { $and: segments } : segments[0]
                }
            });
        }
        return conditions.length > 1 ? { $and: conditions } : conditions[0];
    }

    /**
     * @param {SearchParameterDefinition} component
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]} the andSegments
     *   .filter() returns for this one component/value pair
     */
    filterOneComponent(component, value) {
        const FilterClass = FILTER_CLASS_BY_TYPE[component.type];
        if (!FilterClass) {
            throw new Error(
                `Composite component type=${component.type} has no registered filter class`
            );
        }
        // array-scoped components must not carry the outer useHistoryTable prefix -- their
        // field is relative to the matched array element, applied exactly once via the
        // $elemMatch wrapper's own field name in filterOneScope, not per-component here.
        const componentFieldMapper = component.arrayField
            ? new FieldMapper({ useHistoryTable: false })
            : this.fieldMapper;
        const syntheticParsedArg = new ParsedArgsItem({
            queryParameter: component.firstField,
            queryParameterValue: new QueryParameterValue({ value, operator: '$and' }),
            propertyObj: component,
            modifiers: []
        });
        const filterParameters = new FilterParameters({
            propertyObj: component,
            parsedArg: syntheticParsedArg,
            fieldMapper: componentFieldMapper,
            fnUseAccessIndex: this.fnUseAccessIndex,
            resourceType: this.resourceType
        });
        return new FilterClass(filterParameters).filter();
    }
}

module.exports = {
    FilterByComposite,
    REJECTED_MODIFIERS
};
