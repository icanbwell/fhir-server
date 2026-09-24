const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { SearchManager } = require('../search/searchManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ConfigManager } = require('../../utils/configManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { NotFoundError, BadRequestError } = require('../../utils/httpErrors');
const { OPERATIONS: { READ } } = require('../../constants');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');

class FileDownloadOperation {
    /**
     * @param {Object} params
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {SearchManager} params.searchManager
     * @param {ScopesValidator} params.scopesValidator
     * @param {ConfigManager} params.configManager
     * @param {FhirLoggingManager} params.fhirLoggingManager
     * @param {import('../../utils/s3Client').S3Client|null} params.documentReferenceFileCloudStorageClient
     */
    constructor ({
        databaseQueryFactory,
        searchManager,
        scopesValidator,
        configManager,
        fhirLoggingManager,
        documentReferenceFileCloudStorageClient
    }) {
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        // Nullable — disabled unless enableDocumentReferenceFileOperations is on.
        this.documentReferenceFileCloudStorageClient = documentReferenceFileCloudStorageClient;
    }

    /**
     * Redirects to a presigned S3 GET URL for a previously-uploaded DocumentReference.content[]
     * entry.
     * @param {Object} params
     * @param {import('../common/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {import('../query/parsedArgs').ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {import('express').Response} params.res
     * @returns {Promise<void>}
     */
    async fileDownloadAsync ({ requestInfo, parsedArgs, resourceType, res }) {
        const currentOperationName = 'fileDownload';
        const startTime = Date.now();
        try {
            assertIsValid(parsedArgs.id, 'id is required for $fileDownload');
            assertIsValid(parsedArgs.contentId, 'contentId is required for $fileDownload');

            await this.scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'read'
            });

            if (!this.documentReferenceFileCloudStorageClient) {
                throw new NotFoundError(`Invalid url: ${requestInfo.path}`);
            }

            const { base_version, id, contentId } = parsedArgs;
            const { user, scope, isUser, personIdFromJwtToken } = requestInfo;

            const { query } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                resourceType,
                useAccessIndex: this.configManager.useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                operation: READ,
                accessRequested: 'read'
            });

            const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
            const cursor = await databaseQueryManager.findAsync({ query });
            let resources = await cursor.toArrayAsync();
            resources = FhirResourceWriteSerializer.serializeArray({ obj: resources }) || [];

            if (resources.length > 1) {
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}. Please use uuid to query.`
                ));
            }
            if (resources.length === 0) {
                throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
            }
            const foundResource = resources[0];

            const contentEntry = (foundResource.content || []).find((c) => c.id === contentId);
            if (!contentEntry) {
                throw new NotFoundError(`Content not found: ${resourceType}/${id}/${contentId}`);
            }

            const fileName = contentEntry.attachment && contentEntry.attachment.title;
            const key = `DocumentReference_4_0_0/${foundResource._uuid}/content/${contentId}` +
                (fileName ? `/${fileName}` : '');

            if (!(await this.documentReferenceFileCloudStorageClient.existsAsync(key))) {
                throw new NotFoundError(`Content not found: ${resourceType}/${id}/${contentId}`);
            }

            const url = await this.documentReferenceFileCloudStorageClient.getPresignedGetUrlAsync({
                filePath: key,
                expiresInSeconds: this.configManager.documentReferenceFileDownloadUrlExpiryInSeconds
            });

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo, args: parsedArgs.getRawArgs(), resourceType, startTime, action: currentOperationName
            });

            res.redirect(302, url);
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo, args: parsedArgs.getRawArgs(), resourceType, startTime, action: currentOperationName, error: e
            });
            throw e;
        }
    }
}

module.exports = { FileDownloadOperation };
