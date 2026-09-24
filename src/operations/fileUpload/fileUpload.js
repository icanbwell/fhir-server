const deepcopy = require('deepcopy');

const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { SearchManager } = require('../search/searchManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ConfigManager } = require('../../utils/configManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { NotFoundError, BadRequestError } = require('../../utils/httpErrors');
const { OPERATIONS: { WRITE } } = require('../../constants');
const { generateUUID } = require('../../utils/uid.util');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
const DocumentReferenceContentSerializer = require('../../fhir/writeSerializers/4_0_0/backboneElements/documentReferenceContent');

const FILE_NAME_MAX_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_PATTERN = /[/\\\x00-\x1f]|\.\./;

class FileUploadOperation {
    /**
     * @param {Object} params
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {DatabaseUpdateFactory} params.databaseUpdateFactory
     * @param {SearchManager} params.searchManager
     * @param {ScopesValidator} params.scopesValidator
     * @param {ConfigManager} params.configManager
     * @param {FhirLoggingManager} params.fhirLoggingManager
     * @param {import('../../utils/s3Client').S3Client|null} params.documentReferenceFileCloudStorageClient
     */
    constructor ({
        databaseQueryFactory,
        databaseUpdateFactory,
        searchManager,
        scopesValidator,
        configManager,
        fhirLoggingManager,
        documentReferenceFileCloudStorageClient
    }) {
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

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
     * Mints a presigned S3 PUT URL and appends a new DocumentReference.content[] entry pointing
     * at this resource's own $fileDownload operation.
     * @param {Object} params
     * @param {import('../common/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {import('../query/parsedArgs').ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @returns {Promise<{contentId: string, uploadUrl: string, expiresAt: string}>}
     */
    async fileUploadAsync ({ requestInfo, parsedArgs, resourceType }) {
        const currentOperationName = 'fileUpload';
        const startTime = Date.now();
        try {
            if (!this.documentReferenceFileCloudStorageClient) {
                throw new NotFoundError(`Invalid url: ${requestInfo.path}`);
            }

            assertIsValid(parsedArgs.id, 'id is required for $fileUpload');

            const { base_version, id, fileName, contentType } = parsedArgs;
            const sanitizedFileName = this._sanitizeFileName(fileName);

            await this.scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            });

            const { user, scope, isUser, personIdFromJwtToken } = requestInfo;

            const { query } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                resourceType,
                useAccessIndex: this.configManager.useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                operation: WRITE,
                accessRequested: 'write'
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

            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo, resource: foundResource, base_version
            });

            const contentId = generateUUID();
            const key = `DocumentReference_4_0_0/${foundResource._uuid}/content/${contentId}` +
                (sanitizedFileName ? `/${sanitizedFileName}` : '');

            const expiresInSeconds = this.configManager.documentReferenceFileUploadUrlExpiryInSeconds;
            const uploadUrl = await this.documentReferenceFileCloudStorageClient.getPresignedPutUrlAsync({
                filePath: key,
                contentType,
                expiresInSeconds
            });

            const downloadUrl = this._buildDownloadUrl({ requestInfo, base_version, id: foundResource.id, contentId });

            const updatedResource = deepcopy(foundResource);
            updatedResource.content = updatedResource.content || [];
            const contentEntry = {
                id: contentId,
                attachment: {
                    url: downloadUrl,
                    contentType,
                    title: sanitizedFileName,
                    creation: new Date().toISOString()
                }
            };
            FhirResourceWriteSerializer.serialize({
                obj: contentEntry,
                SerializerClass: DocumentReferenceContentSerializer,
                context: { resourceType: 'DocumentReference' }
            });
            updatedResource.content.push(contentEntry);

            const fastDatabaseUpdateManager = this.databaseUpdateFactory.createFastDatabaseUpdateManager({
                resourceType, base_version
            });
            const { savedResource } = await fastDatabaseUpdateManager.replaceOneAsync({
                base_version, requestInfo, doc: updatedResource, smartMerge: true
            });
            if (!savedResource) {
                throw new BadRequestError(new Error('Failed to save DocumentReference content entry'));
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo, args: parsedArgs.getRawArgs(), resourceType, startTime, action: currentOperationName
            });

            return {
                contentId,
                uploadUrl,
                expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
            };
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo, args: parsedArgs.getRawArgs(), resourceType, startTime, action: currentOperationName, error: e
            });
            throw e;
        }
    }

    /**
     * Rejects a client-supplied fileName that could escape the intended S3 key prefix
     * (path separators, `..` traversal, control characters) or that is unreasonably long.
     * @param {string|undefined} fileName
     * @returns {string|undefined}
     * @private
     */
    _sanitizeFileName (fileName) {
        if (!fileName) {
            return undefined;
        }
        if (fileName.length > FILE_NAME_MAX_LENGTH || INVALID_FILE_NAME_PATTERN.test(fileName)) {
            throw new BadRequestError(new Error(`Invalid fileName: ${fileName}`));
        }
        return fileName;
    }

    /**
     * @param {Object} params
     * @param {import('../common/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.id
     * @param {string} params.contentId
     * @returns {string}
     * @private
     */
    _buildDownloadUrl ({ requestInfo, base_version, id, contentId }) {
        const { protocol, host, externalReqUrlPrefix } = requestInfo;
        if (externalReqUrlPrefix) {
            return `${externalReqUrlPrefix}/DocumentReference/${id}/${contentId}/$fileDownload`;
        }
        return `${protocol}://${host}/${base_version}/DocumentReference/${id}/${contentId}/$fileDownload`;
    }
}

module.exports = { FileUploadOperation };
