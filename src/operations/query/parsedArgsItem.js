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
     * @param {ParsedReferenceItem[]|undefined} references
     */
    constructor({queryParameter, queryParameterValue, propertyObj, modifiers,
                references}) {
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
        /**
         * @type {ParsedReferenceItem[]|undefined}
         */
        this.references = references;
    }
}

module.exports = {
    ParsedArgsItem,
    ParsedReferenceItem
};
