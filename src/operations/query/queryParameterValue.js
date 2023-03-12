/**
 * @desc Type of operation
 * @desc and = do an AND operation between the array items
 * @desc or = do an OR operation between the array items
 * @typedef {('$and'|'$or')} QueryParameterType
 **/
const {assertIsValid} = require('../../utils/assertType');


class QueryParameterValue {
    /**
     * constructor
     * @param {string|string[]} value
     * @param {QueryParameterType|undefined} operator
     */
    constructor(
        {
            value,
            operator = '$and'
        }
    ) {
        /**
         * @type {string|string[]}
         */
        this.value = value;
        /**
         * @type {QueryParameterType}
         */
        this.operator = operator;
        if (typeof value === 'string' && value.includes(',')) {
            this.operator = '$or';
        }
        assertIsValid(['$or', '$and'].includes(operator), `operator ${operator} is not in $or, $and`);
    }

    /**
     * @param {string|string[]|undefined|null} queryParameterValue
     * @return {string[]|null}
     */
    parseQueryParameterValueIntoArrayIfNeeded({queryParameterValue}) {
        if (!queryParameterValue) {
            return null;
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

        return [queryParameterValue];
    }

    /**
     * returns values for this arg as an array
     * @return {string[]|null}
     */
    get values() {
        return this.parseQueryParameterValueIntoArrayIfNeeded(
            {
                queryParameterValue: this.value
            }
        );
    }

    clone() {
        return new QueryParameterValue({
            value: this.value,
            operator: this.operator
        });
    }
}

module.exports = {
    QueryParameterValue
};

