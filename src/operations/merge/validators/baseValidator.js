class BaseValidator {
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
    // eslint-disable-next-line no-unused-vars
    async validate({scope, user, path, currentDate, incomingResources, requestId, base_version}) {
        throw Error('Not implemented');
    }
}

module.exports = {
    BaseValidator
};
