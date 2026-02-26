/**
 * @desc Type of operation
 * @desc and = do an AND operation between the array items
 * @desc or = do an OR operation between the array items
 * @typedef {('token'|'string'|'reference'|'date'|'quantity'|'uri'|'datetime'|'instant'|'period'|'email'|'phone'|'canonical'|'number'|'special')} SearchParameterDefinitionType
 **/

/**
 * @classdesc This class defines a Search Parameter from FHIR spec
 */
class SearchParameterDefinition {
    /**
     * constructor
     * @param {string|undefined} [description]
     * @param {SearchParameterDefinitionType} type
     * @param {string|undefined} [field]
     * @param {string[]|undefined} [fields]
     * @param {string|undefined} [fieldFilter]
     * @param {string[]|undefined} [target]
     * @param {string|undefined} [fieldType]
     * @param {Object|undefined} [fieldTypesObj]
     */
    constructor (
        {
            description,
            type,
            field,
            fields,
            fieldFilter,
            target,
            fieldType,
            fieldTypesObj
        }
    ) {
        /**
         * @type {string|undefined}
         */
        this.description = description;
        /**
         * @type {SearchParameterDefinitionType}
         */
        this.type = type;
        /**
         * @type {string|undefined}
         */
        this._field = field;
        /**
         * @type {string[]|undefined}
         */
        this._fields = fields;
        /**
         * @type {string|undefined}
         */
        this.fieldFilter = fieldFilter;
        /**
         * @type {string[]|undefined}
         */
        this.target = target;
        /**
         * @type {string|undefined}
         */
        this.fieldType = fieldType;
        /**
         * @type {Object|undefined}
         */
        this.fieldTypesObj = fieldTypesObj;
    }

    /**
     * Return the fields for this search parameter
     * @return {string[]}
     */
    get fields () {
        return this._fields ? this._fields : this._field ? [this._field] : [];
    }

    /**
     * returns the first field for this search parameter or null if there are no fields
     * @return {string|null}
     */
    get firstField () {
        return this.fields.length > 0 ? this.fields[0] : null;
    }

    clone () {
        return new SearchParameterDefinition(
            {
                description: this.description,
                type: this.type,
                field: this._field,
                fields: this._fields,
                fieldFilter: this.fieldFilter,
                target: this.target,
                fieldType: this.fieldType,
                fieldTypesObj: this.fieldTypesObj
            }
        );
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        return {
            description: this.description,
            type: this.type,
            field: this._field,
            fields: this._fields,
            fieldFilter: this.fieldFilter,
            target: this.target,
            fieldType: this.fieldType,
            fieldTypesObj: this.fieldTypesObj
        };
    }
}

module.exports = {
    SearchParameterDefinition
};
