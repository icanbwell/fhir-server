const { BaseValidator } = require('./baseValidator');

class WriteAllowedByPatientScopeValidator extends BaseValidator {
    /**
     * @param {string|null} scope
     * @param {string|null} user
     * @param {string|null} path
     * @param {date} currentDate
     * @param {Resource|Resource[]} incomingResources
     * @param {string} requestId
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate (
        {
            scope,
            user,
            path,
            currentDate,
            incomingResources,
            requestId,
            base_version
        }
        ) {
        return { validatedObjects: incomingResources, preCheckErrors: [], wasAList: false };
    }
}

module.exports = {
    WriteAllowedByPatientScopeValidator
};
