const {assertIsValid} = require('../../utils/assertType');
const {removeNull} = require('../../utils/nullRemover');

class ParsedArgs {
    /**
     * constructor
     * @param {string} base_version
     * @param {ParsedArgsItem[]} [parsedArgItems]
     * @param {Object|undefined} [headers]
     */
    constructor ({base_version, parsedArgItems = [], headers}) {
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
        this.headers = headers;
    }

    /**
     * adds an arg
     * @param {ParsedArgsItem} parsedArgItem
     * @return {ParsedArgs}
     */
    add (parsedArgItem) {
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
                    get: () => parsedArgItem.queryParameterValue.value,
                    set: valueProvided => {
                        parsedArgItem.queryParameterValue.value = valueProvided;
                    }
                }
            );
            // special case to handle backwards compatibility
            if (propertyName === '_id') {
                Object.defineProperty(
                    this,
                    'id',
                    {
                        get: () => parsedArgItem.queryParameterValue.value,
                        set: valueProvided => {
                            parsedArgItem.queryParameterValue.value = valueProvided;
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
     * @return {ParsedArgsItem|undefined}
     */
    get (argName) {
        return this.parsedArgItems.find(a => a.queryParameter === argName);
    }

    /**
     * get original Arg i.e., before query rewrites
     * @param {string} argName
     * @return {ParsedArgsItem|undefined}
     */
    getOriginal (argName) {
        return this.originalParsedArgItems.find(a => a.queryParameter === argName);
    }

    /**
     * remove an arg item
     * @param {string} argName
     * @return {ParsedArgs}
     */
    remove (argName) {
        this.parsedArgItems = this.parsedArgItems.filter(a => a.queryParameter !== argName);
        return this;
    }

    /**
     * Clone
     * @return {ParsedArgs}
     */
    clone () {
        return new ParsedArgs(
            {
                base_version: this.base_version,
                parsedArgItems: this.parsedArgItems.map(p => p.clone()),
                headers: this.headers
            }
        );
    }

    /**
     * @return {Object.<string,string|string[]>}
     */
    getRawArgs () {
        const obj = {};
        for (const [, /** @type {ParsedArgsItem} */ value] of Object.entries(this.parsedArgItems)) {
            obj[`${value.queryParameter}`] = value._queryParameterValue.value;
        }
        return obj;
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            base_version: this.base_version,
            parsedArgItems: this.parsedArgItems.map(p => p.toJSON()),
            headers: this.headers
        });
    }
}

module.exports = {
    ParsedArgs
};
