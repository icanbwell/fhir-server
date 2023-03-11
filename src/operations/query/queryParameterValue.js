/**
 * @desc Type of operation
 * @desc and = do an AND operation between the array items
 * @desc or = do an OR operation between the array items
 * @typedef {('and'|'or')} QueryParameterType
 **/


class QueryParameterValue {
    /**
     * constructor
     * @param {string|string[]} value
     * @param {QueryParameterType|undefined} operator
     */
    constructor(
        {
            value,
            operator
        }
    ) {
        /**
         * @type {string|string[]}
         */
        this.value = value;
        /**
         * @type {QueryParameterType|undefined}
         */
        this.operator = operator;
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
        if (
            typeof queryParameterValue === 'string'
        ) {
            const parts = queryParameterValue.split(',');
            if (parts.length > 1) {
                return parts;
            }
        }

        return queryParameterValue;
    }

    get values() {
        return this.parseQueryParameterValueIntoArrayIfNeeded(
            {
                queryParameterValue: this.value
            }
        );
    }
}

module.exports = {
    QueryParameterValue
};

