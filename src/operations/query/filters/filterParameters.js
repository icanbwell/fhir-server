class FilterParameters {
    /**
     * constructor
     * @param {SearchParameterDefinition} propertyObj
     * @param {ParsedArgsItem} parsedArg
     * @param {Set} columns
     * @param {FieldMapper} fieldMapper
     * @param {function(code): boolean} fnUseAccessIndex function that returns whether to use access index for this code
     * @param {string} resourceType
     * @param {boolean|undefined} enableGlobalIdSupport
     */
    constructor(
        {
            propertyObj,
            parsedArg,
            columns,
            fieldMapper,
            fnUseAccessIndex,
            resourceType,
            enableGlobalIdSupport
        }
    ) {
        /**
         * @type {SearchParameterDefinition}
         */
        this.properyObj = propertyObj;
        /**
         * @type {ParsedArgsItem}
         */
        this.parsedArg = parsedArg;
        /**
         * @type {Set}
         */
        this.columns = columns;
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

        /**
         * @type {boolean|undefined}
         */
        this.enableGlobalIdSupport = enableGlobalIdSupport;
    }
}

module.exports = {
    FilterParameters
};
