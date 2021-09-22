const env = require('var');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
/**
 * converts a space separated list of scopes into an array of scopes
 * @param {string} scope
 * @return {string[]}
 */
const parseScopes = (scope) => {
    if (!scope) {
        return [];
    }
    return scope.split(' ');
};

/**
 * Throws an error if no scope is valid for this request
 * @param {string} name
 * @param {string} action
 * @param {string} user
 * @param {?string} scope
 */
module.exports.verifyHasValidScopes = (name, action, user, scope) => {
    if (env.AUTH_ENABLED === '1') {
        // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
        /**
         * @type {string[]}
         */
        let scopes = parseScopes(scope);
        let {error, success} = scopeChecker(name, action, scopes);

        if (success) {
            return;
        }
        let errorMessage = 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + name + '.' + action + ']';
        console.info(errorMessage);
        throw new ForbiddenError(error.message + ': ' + errorMessage);
    }
};

/**
 * Returns all the access codes present in scopes
 * @param {string} action
 * @param {string} user
 * @param {?string} scope
 * @return {string[]}
 */
module.exports.getAccessCodesFromScopes = (action, user, scope) => {
    if (env.AUTH_ENABLED === '1') {
        // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
        /**
         * @type {string[]}
         */
        let scopes = parseScopes(scope);
        /**
         * @type {string[]}
         */
        const access_codes = [];
        /**
         * @type {string}
         */
        for (const scope1 of scopes) {
            if (scope1.startsWith('access')) {
                // ex: access/medstar.*
                /**
                 * @type {string}
                 */
                const inner_scope = scope1.replace('access/', '');
                /**
                 * @type {[string]}
                 */
                const innerScopes = inner_scope.split('.');
                if (innerScopes && innerScopes.length > 0) {
                    /**
                     * @type {string}
                     */
                    const access_code = innerScopes[0];
                    access_codes.push(access_code);
                }
            }
        }
        return access_codes;
    } else {
        return [];
    }
};
