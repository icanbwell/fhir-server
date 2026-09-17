const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { ScopesValidator } = require('../security/scopesValidator');
const { SearchManager } = require('../search/searchManager');
const { ResourceMerger } = require('../common/resourceMerger');
const { ConfigManager } = require('../../utils/configManager');
const { MongoGroupMemberRepository } = require('../../dataLayer/repositories/mongoGroupMemberRepository');
const { BadRequestError, NotFoundError } = require('../../utils/httpErrors');
const { createTooCostlyError } = require('../../utils/fhirErrorFactory');
const { WRITE } = require('../../constants').OPERATIONS;
const Group = require('../../fhir/classes/4_0_0/resources/group');
const { isGroupExtended } = require('../../utils/mongoGroupExtendedTag');
const { hasExternalStorageMemberTag } = require('../../utils/clickHouseGroupPreSave');
const { parseMemberParametersResource } = require('../common/parseMemberParametersResource');
const { enrichMemberReferences } = require('../../utils/referenceEnricher');
const { applyEventsToEmbeddedMembers } = require('../common/embeddedGroupMemberWriter');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');

/**
 * Implements $member-add / $member-remove for Group (DCON-5527).
 *
 * Both operations share one write path: load and scope-check the Group, reject Groups tracked
 * in ClickHouse external storage, bump the Group's own meta.versionId, then branch on regime --
 * embedded Groups mutate member[] inline, extended Groups write through to
 * mongoGroupMemberRepository. Clients never need to know which regime a Group is in.
 */
class GroupMemberWriteOperation {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ScopesValidator} scopesValidator
     * @param {SearchManager} searchManager
     * @param {ResourceMerger} resourceMerger
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ConfigManager} configManager
     * @param {MongoGroupMemberRepository} mongoGroupMemberRepository
     */
    constructor({
        databaseQueryFactory,
        scopesValidator,
        searchManager,
        resourceMerger,
        databaseBulkInserter,
        configManager,
        mongoGroupMemberRepository
    }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        this.databaseQueryFactory = databaseQueryFactory;

        assertTypeEquals(scopesValidator, ScopesValidator);
        this.scopesValidator = scopesValidator;

        assertTypeEquals(searchManager, SearchManager);
        this.searchManager = searchManager;

        assertTypeEquals(resourceMerger, ResourceMerger);
        this.resourceMerger = resourceMerger;

        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        this.databaseBulkInserter = databaseBulkInserter;

        assertTypeEquals(configManager, ConfigManager);
        this.configManager = configManager;

        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {Object} resource - raw Parameters request body
     * @returns {Promise<{id: string, created: boolean, updated: boolean, resource_version: string, resource: Resource}>}
     */
    async addAsync({ requestInfo, parsedArgs, resourceType, resource }) {
        return await this.executeAsync({ requestInfo, parsedArgs, resourceType, resource, op: 'add' });
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {Object} resource - raw Parameters request body
     * @returns {Promise<{id: string, created: boolean, updated: boolean, resource_version: string, resource: Resource}>}
     */
    async removeAsync({ requestInfo, parsedArgs, resourceType, resource }) {
        return await this.executeAsync({ requestInfo, parsedArgs, resourceType, resource, op: 'remove' });
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {Object} resource
     * @param {'add'|'remove'} op
     */
    async executeAsync({ requestInfo, parsedArgs, resourceType, resource, op }) {
        assertIsValid(resourceType === 'Group', `$member-${op} is only supported for Group, got ${resourceType}`);

        const { base_version, id } = parsedArgs;
        const { user, scope, isUser, personIdFromJwtToken } = requestInfo;

        const currentOperationName = `member${op === 'add' ? 'Add' : 'Remove'}`;
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime: Date.now(),
            action: currentOperationName,
            accessRequested: 'write'
        });

        const useAccessIndex = this.configManager.useAccessIndex;
        const { query } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
            parsedArgs,
            operation: WRITE,
            accessRequested: 'write'
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
        const cursor = await databaseQueryManager.findAsync({ query });
        const resources = await cursor.toObjectArrayAsync();

        if (resources.length === 0) {
            throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
        }
        if (resources.length > 1) {
            throw new BadRequestError(new Error(
                `Multiple resources found with id ${id}. Please specify the owner/sourceAssigningAuthority tag or use uuid.`
            ));
        }
        const foundResource = resources[0];

        await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
            requestInfo, resource: foundResource, base_version
        });

        if (hasExternalStorageMemberTag(foundResource)) {
            throw new BadRequestError(new Error(
                `Group ${id} is tracked in ClickHouse external storage; $member-${op} is not supported there. ` +
                'Use PATCH with the useexternalstorage header instead.'
            ));
        }

        // Reject rather than fall back to the embedded regime: a Group already tagged extended
        // has its roster (or part of it) in GroupMember_4_0_0, so writing member[] inline here
        // would silently split the roster across both storage locations.
        if (isGroupExtended(foundResource) && !this.configManager.enableExtendedGroup) {
            throw new BadRequestError(new Error(
                `Group ${id} uses extended member storage, which is disabled on this server ` +
                '(ENABLE_EXTENDED_GROUP is not set).'
            ));
        }

        const sourceAssigningAuthority = foundResource._sourceAssigningAuthority;
        if (!sourceAssigningAuthority) {
            throw new Error(
                `Group ${foundResource.id || foundResource._uuid} has no _sourceAssigningAuthority; cannot enrich member references`
            );
        }

        const events = parseMemberParametersResource(resource, op);

        const memberOperationsLimit = this.configManager.groupPatchOperationsLimit;
        if (events.length > memberOperationsLimit) {
            const batchCount = Math.ceil(events.length / memberOperationsLimit);
            const { message, options } = createTooCostlyError({
                actual: events.length,
                limit: memberOperationsLimit,
                operation: 'PATCH',
                customGuidance: `Split into ${batchCount} batches of ${memberOperationsLimit} member parameters each`
            });
            throw new BadRequestError({ message }, options);
        }

        enrichMemberReferences(events, sourceAssigningAuthority);

        // Reconstruct via the Group constructor rather than foundResource.clone(): the base
        // Resource.clone() returns a plain Resource, silently dropping Group-specific fields
        // (member, actual, type, ...) -- harmless for callers that never touch those fields,
        // but this operation needs member[] intact for the embedded regime.
        const updatedResource = new Group(foundResource.toJSONInternal());

        if (isGroupExtended(foundResource)) {
            this.resourceMerger.updateMeta({
                patched_resource_incoming: updatedResource,
                currentResource: foundResource,
                original_source: foundResource.meta?.source,
                incrementVersion: true
            });

            // Both the Group's own row and its GroupMember rows are queued before the single
            // executeAsync() flush below -- calling executeAsync() twice in one request would
            // queue two separate post-request history-flush tasks sharing the same per-request
            // history map; whichever task actually runs first claims (and clears) every entry
            // present at that moment, silently dropping the other queued resourceType's history.
            await this.databaseBulkInserter.replaceOneAsync({
                requestInfo,
                resourceType,
                uuid: updatedResource._uuid,
                doc: updatedResource
            });

            await this.mongoGroupMemberRepository.applyMemberEventsAsync({
                requestInfo,
                base_version,
                groupUuid: updatedResource._uuid,
                groupVersionId: parseInt(updatedResource.meta.versionId, 10),
                sourceAssigningAuthority,
                securityTags: updatedResource.meta.security,
                events
            });

            await this.databaseBulkInserter.executeAsync({ requestInfo, base_version });
        } else {
            const { members } = applyEventsToEmbeddedMembers(foundResource.member, events);
            updatedResource.member = members;

            this.resourceMerger.updateMeta({
                patched_resource_incoming: updatedResource,
                currentResource: foundResource,
                original_source: foundResource.meta?.source,
                incrementVersion: true
            });

            await this.databaseBulkInserter.replaceOneAsync({
                requestInfo,
                resourceType,
                uuid: updatedResource._uuid,
                doc: updatedResource
            });
            await this.databaseBulkInserter.executeAsync({ requestInfo, base_version });
        }

        // Bare Resource return, matching the convention of other operations dispatched through
        // CustomOperationsController's default branch (expand, validate): readCustomOperation
        // calls .toJSON() on a Resource, so no separate envelope is needed here.
        return FhirResourceSerializer.serialize(updatedResource.toJSONInternal());
    }
}

module.exports = { GroupMemberWriteOperation };
