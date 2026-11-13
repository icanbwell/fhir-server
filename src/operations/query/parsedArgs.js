const { assertIsValid } = require('../../utils/assertType');
const { removeNull } = require('../../utils/nullRemover');
const { NON_SEARCH_QUERY_PARAMS, RESULT_SHAPING_QUERY_PARAMS } = require('../../constants');
const { QueryParameterValue } = require('./queryParameterValue');

class ParsedArgs {
    /**
     * constructor
     * @param {string} base_version
     * @param {ParsedArgsItem[]} [parsedArgItems]
     * @param {Object|undefined} [headers]
     * @param {Readonly<{[resourceType: string]: ReadonlyArray<string>}>|undefined} [viewControlExcludeMap]
     */
    constructor ({ base_version, parsedArgItems = [], headers, viewControlExcludeMap }) {
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

        /**
         * Resource ids the dataConnectionViewControl Consent hides, by resourceType, set when view
         * control is applied to this query (PatientDataViewControlExclusion.applyAsync). The result
         * enrichment uses it to remove Composition sections that reference a hidden resource.
         * @type {Readonly<{[resourceType: string]: ReadonlyArray<string>}>|undefined}
         */
        this.viewControlExcludeMap = viewControlExcludeMap;
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
                (a.modifiers && a.modifiers.toString()) === (parsedArgItem.modifiers && parsedArgItem.modifiers.toString()) &&
                // Two chains on the same base reference param (e.g. general-practitioner
                // chained to .name in one occurrence and .address-state in another) are
                // different constraints and must never collapse into one -- each is evaluated
                // separately per FHIR's chaining rules. Only merge when the chain descriptor
                // (or absence of one) is identical.
                JSON.stringify(a.chain) === JSON.stringify(parsedArgItem.chain)
        );
        if (existingParseArgItem) {
            existingParseArgItem.queryParameterValue = parsedArgItem.queryParameterValue;
            existingParseArgItem.propertyObj = parsedArgItem.propertyObj;
            existingParseArgItem.modifiers = parsedArgItem.modifiers;
            existingParseArgItem.chain = parsedArgItem.chain;
        } else {
            this.parsedArgItems.push(parsedArgItem);
            if (parsedArgItem.modifiers && parsedArgItem.modifiers.length > 0) {
                propertyName = propertyName + ':' + parsedArgItem.modifiers.join(':');
            }
            if (parsedArgItem.chain) {
                propertyName = propertyName + '.' + parsedArgItem.chain.targetParam;
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
     * adds an `:not` exclusion arg, keeping the values of an existing exclusion on the same parameter
     * instead of replacing them (add() replaces). Both lists exclude, so the result excludes the union.
     * Used where one exclusion is added next to another that must survive, e.g. the view-control
     * `_id:not` and a Vulcan `:missing` filter.
     * @param {ParsedArgsItem} parsedArgItem an item whose only modifier is `not`
     * @return {ParsedArgs}
     */
    addMergingExclusion (parsedArgItem) {
        assertIsValid(
            parsedArgItem.isNotOnly,
            'addMergingExclusion requires an item whose only modifier is not'
        );
        const existing = this.parsedArgItems.find(
            a => a.queryParameter === parsedArgItem.queryParameter &&
                a.isNotOnly &&
                !a.chain
        );
        if (existing) {
            parsedArgItem.queryParameterValue = new QueryParameterValue({
                value: [...new Set([
                    ...(existing.queryParameterValue.values || []),
                    ...(parsedArgItem.queryParameterValue.values || [])
                ])],
                // '$or': a mixed uuid/sourceId list becomes two sub-filters, and '$and' would make the
                // $nor exclude nothing (see PatientDataViewControlExclusion.applyAsync)
                operator: '$or'
            });
        }
        return this.add(parsedArgItem);
    }

    /**
     * whether the request addresses resources only by id or _id, with no other search parameter.
     * An id item that only carries the `not` modifier (stored without the colon, as r4ArgsParser and
     * the view-control exclusion build it) is tolerated next to a plain id item, since
     * that is how a consent exclusion narrows an id lookup.
     * @return {boolean}
     */
    isRequestById () {
        const hasPlainId = this.parsedArgItems.some(a => a.isIdItem && !a.modifiers?.length);
        if (!hasPlainId) {
            return false;
        }
        return this.parsedArgItems.every(a => {
            if (a.isIdItem) {
                return !a.modifiers?.length || a.isNotOnly;
            }
            return (
                NON_SEARCH_QUERY_PARAMS.includes(a.queryParameter) ||
                RESULT_SHAPING_QUERY_PARAMS.includes(a.queryParameter)
            );
        });
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
                headers: this.headers,
                // frozen and shared by the whole request, so the clone can share it too
                viewControlExcludeMap: this.viewControlExcludeMap
            }
        );
    }

    /**
     * The args as a flat object, for logs and cache keys. Modifiers are not part of the key, with one
     * exception: an `_id:not` / `id:not` exclusion is keyed `_id:not` / `id:not`. Otherwise it would
     * replace (or be replaced by) the plain `_id` the caller asked for, and the view-control
     * exclusion, which can hold thousands of hidden ids, would be logged as the requested `_id`.
     * @return {Object.<string,string|string[]>}
     */
    getRawArgs () {
        const obj = {};
        for (const [, /** @type {ParsedArgsItem} */ value] of Object.entries(this.parsedArgItems)) {
            const key = value.isIdExclusion ? `${value.queryParameter}:not` : `${value.queryParameter}`;
            obj[key] = value._queryParameterValue.value;
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
