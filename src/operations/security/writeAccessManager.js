const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { WriteAccessCheck } = require('./writeAccessChecks/writeAccessCheck');

/**
 * Orchestrates a list of WriteAccessCheck instances. A write is allowed only if
 * every check allows it.
 */
class WriteAccessManager {
    /**
     * @param {Object} params
     * @param {import('./writeAccessChecks/writeAccessCheck').WriteAccessCheck[]} params.writeAccessChecks
     */
    constructor ({ writeAccessChecks }) {
        assertIsValid(Array.isArray(writeAccessChecks), 'writeAccessChecks must be an array');
        for (const check of writeAccessChecks) {
            assertTypeEquals(check, WriteAccessCheck);
        }
        /**
         * @type {import('./writeAccessChecks/writeAccessCheck').WriteAccessCheck[]}
         */
        this.writeAccessChecks = writeAccessChecks;
    }

    /**
     * Runs every check; the first check that denies throws its ForbiddenError.
     * Returns true if all checks allow the write.
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {Object} params.resource post-preSave resource
     * @param {string} [params.base_version]
     * @returns {Promise<boolean>}
     */
    async checkAsync ({ requestInfo, resource, base_version }) {
        for (const check of this.writeAccessChecks) {
            await check.checkAsync({ requestInfo, resource, base_version });
        }
        return true;
    }
}

module.exports = {
    WriteAccessManager
};
