const {ParsedReferenceItem} = require('./parsedReferenceItem');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {QueryParameterValue} = require('./queryParameterValue');
const {SearchParameterDefinition} = require('../../searchParameters/searchParameterTypes');

/**
 * @classdesc This class holds the parsed structure for an arg on the url
 */
class ParsedArgsItem {
    /**
     * constructor
     * @param {string} queryParameter
     * @param {QueryParameterValue} queryParameterValue
     * @param {SearchParameterDefinition|undefined} propertyObj
     * @param {string[]|undefined} modifiers
     * @param {ParsedReferenceItem[]|undefined} [references]
     */
    constructor(
        {
            queryParameter,
            queryParameterValue,
            propertyObj,
            modifiers,
            references
        }
    ) {
        /**'
         * @type {string}
         */
        this.queryParameter = queryParameter;
        /**
         * @type {QueryParameterValue}
         */
        this._queryParameterValue = queryParameterValue;
        assertTypeEquals(queryParameterValue, QueryParameterValue);
        /**
         * @type {SearchParameterDefinition|undefined}
         */
        this.propertyObj = propertyObj;
        if (propertyObj) {
            assertTypeEquals(propertyObj, SearchParameterDefinition);
        }
        /**
         * @type {string[]}
         */
        this.modifiers = modifiers;

        /**
         * @type {ParsedReferenceItem[]}
         */
        this.references = references;
        if (!references) {
            this.updateReferences();
        }
    }

    /**
     * calculates query parameter value
     * @return {QueryParameterValue|null}
     */
    get queryParameterValue() {
        return this._queryParameterValue;
    }

    /**
     * sets the queryParameterValue
     * @param {QueryParameterValue} value
     */
    set queryParameterValue(value) {
        assertTypeEquals(value, QueryParameterValue);
        this._queryParameterValue = value;
        this.updateReferences();
    }

    /**
     * calculate references
     */
    updateReferences() {
        this.references = this.parseQueryParameterValueIntoReferences(
            {
                queryParameterValue: this.queryParameterValue,
                propertyObj: this.propertyObj
            }
        );
    }

    /**
     * parses a query parameter value for reference into resourceType, id
     * @param {QueryParameterValue} queryParameterValue
     * @param {SearchParameterDefinition|undefined} propertyObj
     * @return {ParsedReferenceItem[]}
     */
    parseQueryParameterValueIntoReferences({queryParameterValue, propertyObj}) {
        assertTypeEquals(queryParameterValue, QueryParameterValue);
        if (!propertyObj) {
            return [];
        }

        assertTypeEquals(propertyObj, SearchParameterDefinition);
        if (!(propertyObj.target)) {
            return [];
        }
        /**
         * @type {ParsedReferenceItem[]}
         */
        const result = [];
        /**
         * @type {string[]|null}
         */
        const queryParameterValues = queryParameterValue.values;
        // The forms are:
        // 1. Patient/123,456
        // 2. 123,456
        // 3. Patient/123, Patient/456
        /**
         * @type {string|null}
         */
        let resourceType = null;
        if (queryParameterValues) {
            assertIsValid(Array.isArray(queryParameterValues), `queryParameterValues is not an array but ${typeof queryParameterValues}`);
            for (const /** @type {string} */ val of queryParameterValues) {
                const valueParts = val.split('/');
                /**
                 * @type {string}
                 */
                let id;
                if (valueParts.length > 1) {
                    resourceType = valueParts[0];
                    id = valueParts[1];
                } else {
                    id = valueParts[0];
                }
                if (resourceType) {
                    // resource type was specified
                    result.push(
                        new ParsedReferenceItem({
                            resourceType,
                            id
                        })
                    );
                } else {
                    for (const target of propertyObj.target) {
                        result.push(
                            new ParsedReferenceItem({
                                resourceType: target,
                                id
                            })
                        );
                    }
                }
            }
        }

        return result;
    }

    clone() {
        return new ParsedArgsItem(
            {
                queryParameter: this.queryParameter,
                queryParameterValue: this._queryParameterValue,
                propertyObj: this.propertyObj,
                modifiers: this.modifiers,
                references: this.references
            }
        );
    }
}


module.exports = {
    ParsedArgsItem
};
