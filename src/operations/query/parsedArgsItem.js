/**
 * @classdesc This class holds the parsed structure for an arg on the url
 */

class ParsedReferenceItem {
    /**
     * constructor
     * @param {string|undefined} resourceType
     * @param {string} id
     */
    constructor({resourceType, id}) {
        /**
         * @type {string|undefined}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.id = id;
    }
}

class ParsedArgsItem {
    /**
     * constructor
     * @param {string} queryParameter
     * @param {string | string[]} queryParameterValue
     * @param {SearchParameterDefinition} propertyObj
     * @param {string[]|undefined} modifiers
     */
    constructor(
        {
            queryParameter,
            queryParameterValue,
            propertyObj,
            modifiers
        }
    ) {
        /**'
         * @type {string}
         */
        this.queryParameter = queryParameter;
        /**
         * @type {string|string[]}
         */
        this._queryParameterValue = queryParameterValue;
        /**
         * @type {SearchParameterDefinition}
         */
        this.propertyObj = propertyObj;
        /**
         * @type {string[]}
         */
        this.modifiers = modifiers;
    }

    /**
     * calculates query parameter value
     * @return {string|string[]|null}
     */
    get queryParameterValue() {
        return this.parseQueryParameterValueIntoArrayIfNeeded(
            {
                queryParameterValue: this._queryParameterValue
            }
        );
    }

    /**
     * sets the queryParameterValue
     * @param value
     */
    set queryParameterValue(value) {
        this._queryParameterValue = value;
    }

    /**
     * calculated references
     * @return {ParsedReferenceItem[]}
     */
    get references() {
        return this.parseQueryParameterValueIntoReferences(
            {
                queryParameterValue: this.queryParameterValue,
                propertyObj: this.propertyObj
            }
        );
    }

    /**
     * @param {string|string[]|undefined|null} queryParameterValue
     * @return {string|string[]|null}
     */
    parseQueryParameterValueIntoArrayIfNeeded({queryParameterValue}) {
        if (!queryParameterValue) {
            return queryParameterValue;
        }
        if (Array.isArray(queryParameterValue)) {
            return queryParameterValue;
        }
        const parts = queryParameterValue.split(',');
        if (parts.length > 1) {
            return parts;
        }
        return queryParameterValue;
    }

    /**
     * parses a query parameter value for reference into resourceType, id
     * @param {string|string[]} queryParameterValue
     * @param {SearchParameterDefinition} propertyObj
     * @return {ParsedReferenceItem[]}
     */
    parseQueryParameterValueIntoReferences({queryParameterValue, propertyObj}) {
        /**
         * @type {ParsedReferenceItem[]}
         */
        const result = [];
        queryParameterValue = Array.isArray(queryParameterValue) ? queryParameterValue : [queryParameterValue];
        // The forms are:
        // 1. Patient/123,456
        // 2. 123,456
        // 3. Patient/123, Patient/456
        /**
         * @type {string|null}
         */
        let resourceType = null;
        for (const /** @type {string} */ val of queryParameterValue) {
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
        return result;
    }
}

module.exports = {
    ParsedArgsItem,
    ParsedReferenceItem
};
