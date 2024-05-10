class FilterParameters {
    /**
     * constructor
     * @param {SearchParameterDefinition} propertyObj
     * @param {ParsedArgsItem} parsedArg
     * @param {FieldMapper} fieldMapper
     * @param {function(code): boolean} fnUseAccessIndex function that returns whether to use access index for this code
     * @param {string} resourceType
     */
    constructor (
        {
            propertyObj,
            parsedArg,
            fieldMapper,
            fnUseAccessIndex,
            resourceType
        }
    ) {
        /**
         * @type {SearchParameterDefinition}
         */
        this.propertyObj = propertyObj;
        /**
         * @type {ParsedArgsItem}
         */
        this.parsedArg = parsedArg;
        /**
         * @type {FieldMapper}
         */
        this.fieldMapper = fieldMapper;

        /**
         * @type {function(code): boolean}
         */
        this.fnUseAccessIndex = fnUseAccessIndex;

        /**
         * @type {string}
         */
        this.resourceType = resourceType;
    }
}

module.exports = {
    FilterParameters
};
