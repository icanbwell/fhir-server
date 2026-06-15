const { DatabaseImportManager } = require('../../dataLayer/databaseImportManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ForbiddenError, NotFoundError } = require('../../utils/httpErrors');
const { ScopesManager } = require('../security/scopesManager');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');

class ImportByIdOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {DatabaseImportManager} databaseImportManager
     *
     * @param {ConstructorParams}
     */
    constructor({ scopesManager, fhirLoggingManager, databaseImportManager }) {
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        this.databaseImportManager = databaseImportManager;
        assertTypeEquals(databaseImportManager, DatabaseImportManager);
    }

    async importByIdAsync({ requestInfo, args }) {
        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'importById';
        const startTime = Date.now();
        const {
            requestId,
            scope
        } = requestInfo;

        const { id } = args;

        assertIsValid(requestId, 'requestId is null');

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk import status cannot be accessed via patient scopes');
        }

        try {
            const importStatusResource = await this.databaseImportManager.getImportStatusResourceWithId({
                importStatusId: id
            });

            if (!importStatusResource) {
                throw new NotFoundError(`ImportStatus resource with id ${id} does not exist`);
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName
            });

            return importStatusResource;
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = { ImportByIdOperation };
