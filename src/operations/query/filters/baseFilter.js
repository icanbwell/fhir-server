const {getIndexHints} = require('../../common/getIndexHints');
const {assertIsValid} = require('../../../utils/assertType');

class BaseFilter {
    /**
     * constructor
     * @param {FilterParameters} filterParameters
     */
    constructor(
        filterParameters
    ) {
        /**
         * @type {SearchParameterDefinition}
         */
        this.propertyObj = filterParameters.propertyObj;
        assertIsValid(filterParameters.propertyObj, 'filterParameters.propertyObj is null');
        /**
         * @type {ParsedArgsItem}
         */
        this.parsedArg = filterParameters.parsedArg;
        assertIsValid(filterParameters.parsedArg, 'filterParameters.parsedArg is null');
        /**
         * @type {Set}
         */
        this.columns = filterParameters.columns;
        /**
         * @type {FieldMapper}
         */
        this.fieldMapper = filterParameters.fieldMapper;
        assertIsValid(filterParameters.fieldMapper, 'filterParameters.fieldMapper is null');

        /**
         * @type {function(code): boolean}
         */
        this.fnUseAccessIndex = filterParameters.fnUseAccessIndex;

        /**
         * @type {string}
         */
        this.resourceType = filterParameters.resourceType;
        assertIsValid(filterParameters.resourceType, 'filterParameters.resourceType is null');


        /**
         * @type {boolean|undefined}
         */
        this.enableGlobalIdSupport = filterParameters.enableGlobalIdSupport;
    }

    /**
     * override this if all you want to do is just provide a filter of a field and value
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return {
            [this.fieldMapper.getFieldName(field)]: value,
        };
    }

    /**
     * filter function that calls filterByItem for each field and each value supplied
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter() {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        const and_segments = [];

        // handle simple case without an OR to keep it simple
        and_segments.push({
                $or: this.propertyObj.fields.map((field) => {
                        return {
                            [this.parsedArg.queryParameterValue.operator]:
                                this.parsedArg.queryParameterValue.values.map(v => {
                                    return this.filterByItem(field, v);
                                })
                        };
                    }
                ),
            },
        );

        this.propertyObj.fields.forEach(field => this.columns.add(this.fieldMapper.getFieldName(field)));
        getIndexHints(this.columns, this.propertyObj);
        return and_segments;
    }
}

module.exports = {
    BaseFilter
};
