class MergeValidator {
    /**
     * @param {Validators[]} validators
     */
    constructor({
        validators
    }) {
        /**
         * @type {Validators[]}
         */
        this.validators = validators;
    }

    /**
     * @param {string} base_version
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Object|Object[]} incomingObjects
     * @param {string|null} path
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string|null} scope
     * @param {string|null} user
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], resourcesIncomingArray: Resources[], wasIncomingAList: boolean}>}
     */
    async validate({
        base_version,
        currentDate,
        currentOperationName,
        incomingObjects,
        path,
        requestId,
        resourceType,
        scope,
        user
    }) {
        /**
         * @type {MergeResultEntry[]}
         */
        const mergePreCheckErrors = [];
        /**
         * @type {boolean}
         */
        let wasIncomingAList = false;

        for (const validator of this.validators) {
            let { validatedObjects, preCheckErrors, wasAList } = await validator.validate({
                base_version,
                currentDate,
                currentOperationName,
                incomingObjects,
                path,
                requestId,
                resourceType,
                scope,
                user
            });

            incomingObjects = validatedObjects;
            if (wasAList) {
                wasIncomingAList = true;
            }

            if (preCheckErrors) {
                mergePreCheckErrors.push(...preCheckErrors);
            }
        }

        return {mergePreCheckErrors, resourcesIncomingArray: incomingObjects, wasIncomingAList};
    }
}

module.exports = {
    MergeValidator
};
