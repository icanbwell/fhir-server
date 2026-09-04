/**
 * @desc Type of operation
 * @desc and = do an AND operation between the array items
 * @desc or = do an OR operation between the array items
 * @typedef {('token'|'string'|'reference'|'date'|'quantity'|'uri'|'datetime'|'instant'|'period'|'email'|'phone'|'canonical'|'number'|'special'|'composite')} SearchParameterDefinitionType
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
     * @param {{components: SearchParameterDefinition[]}[]|undefined} [scopes] composite params only
     * @param {string|null|undefined} [arrayField] composite components only: the array field
     *   this component's `field` lives under (e.g. 'component'), or null for a root-scoped
     *   component
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
            fieldTypesObj,
            scopes,
            arrayField
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
        /**
         * @type {{components: SearchParameterDefinition[]}[]|undefined}
         */
        this.scopes = scopes;
        /**
         * @type {string|null}
         */
        this.arrayField = arrayField || null;
    }

    /**
     * Return the field for this search parameter (convenience getter for _field)
     * @return {string|undefined}
     */
    get field () {
        return this._field;
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
                fieldTypesObj: this.fieldTypesObj,
                scopes: this.scopes
                    ? this.scopes.map(scope => ({ components: scope.components.map(c => c.clone()) }))
                    : undefined,
                arrayField: this.arrayField
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
            fieldTypesObj: this.fieldTypesObj,
            scopes: this.scopes
                ? this.scopes.map(scope => ({ components: scope.components.map(c => c.toJSON()) }))
                : undefined,
            arrayField: this.arrayField
        };
    }
}

module.exports = {
    SearchParameterDefinition
};
