const { assertTypeEquals } = require('../../utils/assertType');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { logInfo, logError } = require('../common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { ScopesValidator } = require('../security/scopesValidator');
const { StorageProviderFactory } = require('../../dataLayer/providers/storageProviderFactory');
const { isTrue } = require('../../utils/isTrue');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { BadRequestError } = require('../../utils/httpErrors');

/**
 * Group $members Operation
 *
 * Returns paginated members from ClickHouse for Groups with external storage
 *
 * Usage: GET /Group/{id}/$members?_count=100&_cursor={reference}
 *
 * Query Parameters:
 * - _count: Number of members to return (default: 100, max: 1000)
 * - _cursor: Pagination cursor (entity_reference to start after)
 *
 * Response: Bundle with member references and pagination links
 */
class MembersOperation {
    /**
     * @param {Object} params
     * @param {FhirLoggingManager} params.fhirLoggingManager
     * @param {ScopesValidator} params.scopesValidator
     * @param {StorageProviderFactory} params.storageProviderFactory
     */
    constructor({ fhirLoggingManager, scopesValidator, storageProviderFactory }) {
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {StorageProviderFactory}
         */
        this.storageProviderFactory = storageProviderFactory;
        assertTypeEquals(storageProviderFactory, StorageProviderFactory);
    }

    /**
     * Executes the $members operation
     *
     * @param {Object} params
     * @param {string} params.base_version - FHIR version
     * @param {Object} params.requestInfo - Request information
     * @param {string} params.id - Group ID
     * @param {Object} params.args - Query parameters
     * @param {Object} params.req - Express request
     * @param {Object} params.res - Express response
     * @returns {Promise<Object>} Bundle with members
     */
    async processAsync({ base_version, requestInfo, id, args, req, res }) {
        try {
            const requestId = requestInfo.requestId;

            logInfo('$members operation started', {
                requestId,
                groupId: id,
                args
            });

            // Verify OAuth scopes for Group read access
            await this.scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                base_version,
                resourceType: 'Group',
                accessRequested: 'read'
            });

            // Check if useExternalStorage header is set
            const useExternalStorage = isTrue(req.headers?.[USE_EXTERNAL_STORAGE_HEADER]);
            if (!useExternalStorage) {
                throw new BadRequestError(
                    '$members operation requires useExternalStorage: true header'
                );
            }

            // Parse pagination parameters
            const limit = this._parseCount(args._count);
            const afterReference = args._cursor || null;

            // Get storage provider
            const storageProvider = this.storageProviderFactory.createProvider({
                resourceType: 'Group',
                base_version
            });

            // Check if this is a mongo-with-clickhouse provider
            if (typeof storageProvider.getCurrentMembersWithCountAsync !== 'function') {
                throw new BadRequestError(
                    '$members operation is only available for Groups with ClickHouse external storage'
                );
            }

            // Get members from ClickHouse
            const { members, totalCount } = await storageProvider.getCurrentMembersWithCountAsync(
                id,
                { limit, afterReference }
            );

            logInfo('$members operation completed', {
                requestId,
                groupId: id,
                membersReturned: members.length,
                totalCount
            });

            // Build Bundle response
            const bundle = this._buildMembersBundle({
                groupId: id,
                members,
                totalCount,
                limit,
                afterReference,
                base_version,
                req
            });

            return bundle;
        } catch (error) {
            logError('Error executing $members operation', {
                error: error.message,
                stack: error.stack,
                groupId: id
            });

            throw new RethrownError({
                message: `Error executing $members operation for Group/${id}`,
                error,
                args: { base_version, id, args }
            });
        }
    }

    /**
     * Parses _count parameter with validation
     * @param {string|number} count - Count parameter
     * @returns {number} Validated count
     * @private
     */
    _parseCount(count) {
        const DEFAULT_COUNT = 100;
        const MAX_COUNT = 1000;

        if (!count) {
            return DEFAULT_COUNT;
        }

        const parsed = parseInt(count, 10);
        if (isNaN(parsed) || parsed < 1) {
            return DEFAULT_COUNT;
        }

        return Math.min(parsed, MAX_COUNT);
    }

    /**
     * Builds a Bundle response with member references
     * @param {Object} params
     * @returns {Object} FHIR Bundle
     * @private
     */
    _buildMembersBundle({ groupId, members, totalCount, limit, afterReference, base_version, req }) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const selfUrl = `${baseUrl}/${base_version}/Group/${groupId}/$members?_count=${limit}`;
        const selfUrlWithCursor = afterReference
            ? `${selfUrl}&_cursor=${encodeURIComponent(afterReference)}`
            : selfUrl;

        // Convert ClickHouse member rows to FHIR entry format
        const entries = members.map(member => ({
            fullUrl: `${baseUrl}/${base_version}/${member.entity_reference}`,
            resource: {
                entity: {
                    reference: member.entity_reference
                }
            }
        }));

        // Build pagination links
        const links = [
            {
                relation: 'self',
                url: selfUrlWithCursor
            }
        ];

        // Add next link if there are more results
        if (members.length === limit) {
            const lastReference = members[members.length - 1].entity_reference;
            const nextUrl = `${selfUrl}&_cursor=${encodeURIComponent(lastReference)}`;
            links.push({
                relation: 'next',
                url: nextUrl
            });
        }

        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: totalCount,
            link: links,
            entry: entries.length > 0 ? entries : undefined
        };
    }

}

module.exports = { MembersOperation };
