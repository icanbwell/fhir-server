/**
 * @classdesc This class holds the parsed structure for an arg on the url
 */
class ParsedArgsItem {
    /**
     * constructor
     * @param {string} queryParameter
     * @param {string | string[]} queryParameterValue
     * @param {SearchParameterDefinition} propertyObj
     * @param {string[]|undefined} modifiers
     */
    constructor({queryParameter, queryParameterValue, propertyObj, modifiers}) {
        /**'
         * @type {string}
         */
        this.queryParameter = queryParameter;
        /**
         * @type {string|string[]}
         */
        this.queryParameterValue = queryParameterValue;
        /**
         * @type {SearchParameterDefinition}
         */
        this.propertyObj = propertyObj;
        /**
         * @type {string[]}
         */
        this.modifiers = modifiers;
    }
}

module.exports = {
    ParsedArgsItem
};
