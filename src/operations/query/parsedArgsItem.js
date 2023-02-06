const {assertIsValid} = require('../../utils/assertType');

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
     * @param {ParsedReferenceItem[]|undefined} [references]
     */
    constructor(
        {
            queryParameter,
            queryParameterValue,
            propertyObj,
            modifiers,
            references
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

        /**
         * @type {ParsedReferenceItem[]}
         */
        this.references = references;
        if (!references) {
            this.updateReferences();
        }
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
     * calculates query parameter values
     * @return {string[]}
     */
    get queryParameterValues() {
        const value = this.parseQueryParameterValueIntoArrayIfNeeded(
            {
                queryParameterValue: this._queryParameterValue
            }
        );
        return value === null ? [] : Array.isArray(value) ? value : [value];
    }

    /**
     * sets the queryParameterValue
     * @param value
     */
    set queryParameterValue(value) {
        this._queryParameterValue = value;
        this.updateReferences();
    }

    /**
     * calculate references
     */
    updateReferences() {
        this.references = this.parseQueryParameterValueIntoReferences(
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
        if (typeof queryParameterValue === 'string') {
            const parts = queryParameterValue.split(',');
            if (parts.length > 1) {
                return parts;
            }
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
        if (!propertyObj) {
            return [];
        }
        if (!(propertyObj.target)) {
            return [];
        }
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

    clone() {
        return new ParsedArgsItem(
            {
                queryParameter: this.queryParameter,
                queryParameterValue: this._queryParameterValue,
                propertyObj: this.propertyObj,
                modifiers: this.modifiers,
                references: this.references
            }
        );
    }
}

class ParsedArgs {
    /**
     * constructor
     * @param {string} base_version
     * @param {ParsedArgsItem[]} [parsedArgItems]
     */
    constructor({base_version, parsedArgItems = []}) {
        assertIsValid(base_version, 'base_version is missing');
        this.base_version = base_version;
        /**
         * @type {ParsedArgsItem[]}
         */
        this.parsedArgItems = [];
        for (const parsedArgItem of parsedArgItems) {
            this.add(parsedArgItem);
        }
        /**
         * args before query rewrites
         * @type {ParsedArgsItem[]}
         */
        this.originalParsedArgItems = this.parsedArgItems.map(a => a.clone());

        /**
         * headers
         * @type {Object|undefined}
         */
        this.headers = undefined;
    }

    /**
     * adds an arg
     * @param {ParsedArgsItem} parsedArgItem
     * @return {ParsedArgs}
     */
    add(parsedArgItem) {
        /**
         * @type {string}
         */
        let propertyName = parsedArgItem.queryParameter;
        /**
         * @type {ParsedArgsItem|undefined}
         */
        const existingParseArgItem = this.parsedArgItems.find(
            a => a.queryParameter === propertyName &&
                (a.modifiers && a.modifiers.toString()) === (parsedArgItem.modifiers && parsedArgItem.modifiers.toString())
        );
        if (existingParseArgItem) {
            existingParseArgItem.queryParameterValue = parsedArgItem.queryParameterValue;
            existingParseArgItem.propertyObj = parsedArgItem.propertyObj;
            existingParseArgItem.modifiers = parsedArgItem.modifiers;
        } else {
            this.parsedArgItems.push(parsedArgItem);
            if (parsedArgItem.modifiers && parsedArgItem.modifiers.length > 0) {
                propertyName = propertyName + ':' + parsedArgItem.modifiers.join(':');
            }
            Object.defineProperty(
                this,
                propertyName,
                {
                    get: () => parsedArgItem.queryParameterValue,
                    set: valueProvided => {
                        parsedArgItem.queryParameterValue = valueProvided;
                    }
                }
            );
            // special case to handle backwards compatibility
            if (propertyName === '_id') {
                Object.defineProperty(
                    this,
                    'id',
                    {
                        get: () => parsedArgItem.queryParameterValue,
                        set: valueProvided => {
                            parsedArgItem.queryParameterValue = valueProvided;
                        }
                    }
                );
            }

        }
        return this;
    }

    /**
     * get Arg
     * @param {string} argName
     * @return {ParsedArgsItem}
     */
    get(argName) {
        return this.parsedArgItems.find(a => a.queryParameter === argName);
    }

    /**
     * get original Arg i.e., before query rewrites
     * @param {string} argName
     * @return {ParsedArgsItem}
     */
    getOriginal(argName) {
        return this.originalParsedArgItems.find(a => a.queryParameter === argName);
    }

    /**
     * remove an arg item
     * @param {string} argName
     * @return {ParsedArgs}
     */
    remove(argName) {
        this.parsedArgItems = this.parsedArgItems.filter(a => a.queryParameter !== argName);
        return this;
    }

    /**
     * Clone
     * @return {ParsedArgs}
     */
    clone() {
        return new ParsedArgs(
            {
                base_version: this.base_version,
                parsedArgItems: this.parsedArgItems.map(p => p.clone())
            }
        );
    }

    getRawArgs() {
        const obj = {};
        for (const [, /** @type {ParsedArgsItem} */ value] of Object.entries(this.parsedArgItems)) {
            obj[`${value.queryParameter}`] = value._queryParameterValue;
        }
        return obj;
    }
}

module.exports = {
    ParsedArgsItem,
    ParsedReferenceItem,
    ParsedArgs
};
