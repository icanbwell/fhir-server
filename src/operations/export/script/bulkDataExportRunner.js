const deepcopy = require('deepcopy');
const moment = require('moment-timezone');

const ExportStatusEntry = require('../../../fhir/classes/4_0_0/custom_resources/exportStatusEntry');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { EnrichmentManager } = require('../../../enrich/enrich');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { PatientQueryCreator } = require('../../common/patientQueryCreator');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { RethrownError } = require('../../../utils/rethrownError');
const { BadRequestError } = require('../../../utils/httpErrors');
const { R4ArgsParser } = require('../../query/r4ArgsParser');
const { R4SearchQueryCreator } = require('../../query/r4');
const { S3Client } = require('../../../utils/s3Client');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { isUuid } = require('../../../utils/uid.util');
const { logInfo, logError, logDebug } = require('../../common/logging');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const {
    COLLECTION,
    GRIDFS,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP
} = require('../../../constants');
const { SearchManager } = require('../../search/searchManager');
const { ResourceLocatorFactory } = require('../../common/resourceLocatorFactory');
const { FhirResourceCreator } = require('../../../fhir/fhirResourceCreator');
const { ResourceLocator } = require('../../common/resourceLocator');
const { S3MultiPartContext } = require('./s3MultiPartContext');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../utils/bulkExportEventProducer');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const { StorageProviderFactory } = require('../../../dataLayer/providers/storageProviderFactory');
const { hasExternalStorageMemberTag } = require('../../../utils/clickHouseGroupPreSave');

class BulkDataExportRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseExportManager} databaseExportManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {R4SearchQueryCreator} r4SearchQueryCreator
     * @property {PatientQueryCreator} patientQueryCreator
     * @property {EnrichmentManager} enrichmentManager
     * @property {ResourceLocatorFactory} resourceLocatorFactory
     * @property {R4ArgsParser} r4ArgsParser
     * @property {SearchManager} searchManager
     * @property {PostSaveProcessor} postSaveProcessor
     * @property {BulkExportEventProducer} bulkExportEventProducer
     * @property {StorageProviderFactory} storageProviderFactory
     * @property {string} exportStatusId
     * @property {number} patientReferenceBatchSize
     * @property {number} fetchResourceBatchSize
     * @property {S3Client} s3Client
     * @property {number} uploadPartSize
     * @property {string} requestId
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        databaseExportManager,
        patientFilterManager,
        databaseAttachmentManager,
        r4SearchQueryCreator,
        patientQueryCreator,
        enrichmentManager,
        resourceLocatorFactory,
        r4ArgsParser,
        searchManager,
        postSaveProcessor,
        bulkExportEventProducer,
        storageProviderFactory,
        exportStatusId,
        patientReferenceBatchSize,
        fetchResourceBatchSize,
        s3Client,
        uploadPartSize,
        requestId
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {DatabaseExportManager}
         */
        this.databaseExportManager = databaseExportManager;
        assertTypeEquals(databaseExportManager, DatabaseExportManager);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);

        /**
         * @type {PatientQueryCreator}
         */
        this.patientQueryCreator = patientQueryCreator;
        assertTypeEquals(patientQueryCreator, PatientQueryCreator);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {S3Client}
         */
        this.s3Client = s3Client;
        assertTypeEquals(s3Client, S3Client);

        /**
         * @type {string}
         */
        this.exportStatusId = exportStatusId;
        assertIsValid(exportStatusId, 'exportStatusId is required for running BulkExport');

        /**
         * @type {number}
         */
        this.patientReferenceBatchSize = patientReferenceBatchSize;

        /**
         * @type {number}
         */
        this.fetchResourceBatchSize = fetchResourceBatchSize;

        /**
         * @type {import('../../../fhir/classes/4_0_0/custom_resources/exportStatus')|null}
         */
        this.exportStatusResource = null;

        /**
         * @type {number}
         */
        this.uploadPartSize = uploadPartSize;

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);

        /**
         * @type {BulkExportEventProducer}
         */
        this.bulkExportEventProducer = bulkExportEventProducer;
        assertTypeEquals(bulkExportEventProducer, BulkExportEventProducer);

        /**
         * @type {StorageProviderFactory}
         */
        this.storageProviderFactory = storageProviderFactory;
        assertTypeEquals(storageProviderFactory, StorageProviderFactory);

        /**
         * @type {string}
         */
        this.requestId = requestId;
        assertIsValid(requestId, 'Invalid request id.');
    }

    /**
     * main process
     */
    async processAsync() {
        try {
            const startTime = Date.now();
            this.exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                    exportStatusId: this.exportStatusId
                });

            if (!this.exportStatusResource) {
                logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            if (this.exportStatusResource.status !== 'accepted') {
                logInfo(
                    `Export already triggered for ExportStatus resource with Id- ${this.exportStatusId}, ` +
                        `current status: ${this.exportStatusResource.status}`
                );
                return;
            }

            // Update status of ExportStatus resource to in-progress
            this.exportStatusResource.status = 'in-progress';
            await this.updateExportStatusResource();
            logInfo(
                `ExportStatus resource marked as in-progress with Id: ${this.exportStatusId}`,
                { exportStatusId: this.exportStatusId }
            );

            // compute base folder where data will be upload in s3
            const accessTags = this.exportStatusResource.meta.security
                .filter(s => s.system === SecurityTagSystem.access)
                .map(s => s.code);
            if (accessTags.length === 0) {
                accessTags.push('bwell');
            }
            this.baseS3Folder = `exports/${accessTags.join('_')}/${this.exportStatusId}`;

            const { pathname, searchParams } = new URL(this.exportStatusResource.request);

            // to be used while making query
            searchParams.append('base_version', pathname.split('/')[1]);

            let query = await this.getQueryForExport({
                user: this.exportStatusResource.user,
                scope: this.exportStatusResource.scope,
                searchParams
            });

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the requested resources to export
                const requestedResources = await this.getRequestedResourceAsync({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.values(COLLECTION)
                });

                for (const resourceType of requestedResources) {
                    await this.processResourceAsync({ resourceType, query, searchParams });
                }
            } else {
                const requestedResources = await this.getRequestedResourceAsync({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources:
                        this.patientFilterManager.getAllPatientOrPersonRelatedResources()
                });

                const groupMatch = pathname.match(/^\/4_0_0\/Group\/([^/]+)\/\$export$/);
                if (groupMatch) {
                    // Group-level export: resolve the member Patient references, then
                    // reuse the patient-compartment export for each requested resource.
                    const memberPatientReferences = await this.getGroupMemberPatientReferencesAsync({
                        groupId: decodeURIComponent(groupMatch[1]),
                        query
                    });
                    for (const resourceType of requestedResources) {
                        await this.handlePatientExportAsync({
                            searchParams,
                            query,
                            resourceType,
                            memberPatientReferences,
                            isGroupExport: true
                        });
                    }
                } else if (pathname.startsWith('/4_0_0/Patient/$export')) {
                    for (const resourceType of requestedResources) {
                        await this.handlePatientExportAsync({
                            searchParams,
                            query,
                            resourceType
                        });
                    }
                }
            }

            // Update status of ExportStatus resource to completed and add output and error
            this.exportStatusResource.status = 'completed';
            await this.updateExportStatusResource();

            const endTime = Date.now();
            const elapsedTime = endTime - startTime;
            logInfo(
                `ExportStatus resource marked as completed with Id: ${this.exportStatusId}`,
                { exportStatusId: this.exportStatusId, timeTaken: this.formatTime(elapsedTime) }
            );
        } catch (err) {
            if (this.exportStatusResource) {
                // Update status of ExportStatus resource to failed if ExportStatus resource exists
                this.exportStatusResource.status = 'entered-in-error';
                await this.updateExportStatusResource();
                logInfo(
                    `ExportStatus resource marked as entered-in-error with Id: ${this.exportStatusId}`,
                    { exportStatusId: this.exportStatusId }
                );
            }
            logError(`ERROR: ${err.message}`, {
                error: err.stack
            });
        }
    }

    /**
     * Function to format time in milliseconds to human readable format
     * @param {*} milliseconds number of milliseconds
     * @returns human readable format time
     */
    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return `${hours} hours, ${minutes % 60} minutes, ${seconds % 60} seconds`;
    }

    /**
     * @typedef {Object} GetQueryForExportParams
     * @param {string} user
     * @param {string} scope
     * @property {URLSearchParams} searchParams
     *
     * @param {GetQueryForExportParams}
     */
    async getQueryForExport({ user, scope, searchParams }) {
        let query = {};

        const parsedArgs = this.r4ArgsParser.parseArgs({
            resourceType: 'ExportStatus',
            args: Object.fromEntries(searchParams)
        });
        ({
            /** @type {import('mongodb').Document}**/
            query
        } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser: false,
            resourceType: 'ExportStatus',
            parsedArgs: parsedArgs
        }));
        if (searchParams.has('_since')) {
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({
                query,
                andQuery: {
                    'meta.lastUpdated': {
                        $gte: moment.utc(searchParams.get('_since')).toDate()
                    }
                }
            });
        }

        return query;
    }

    /**
     * Function to update export status resource
     */
    async updateExportStatusResource() {
        await this.databaseExportManager.updateExportStatusAsync({
            exportStatusResource: this.exportStatusResource
        });
        await this.postSaveProcessor.afterSaveAsync({
            requestId: this.requestId,
            eventType: 'U',
            resourceType: 'ExportStatus',
            doc: this.exportStatusResource
        });
        await this.postSaveProcessor.flushAsync();
        await this.bulkExportEventProducer.produce({
            resource: this.exportStatusResource,
            requestId: this.requestId
        });
    }

    /**
     * Gets requested resources from allowed resources based on scope and _type param
     * @typedef {Object} GetRequestedResourceAsyncParams
     * @property {string} scope
     * @property {URLSearchParams} searchParams
     * @property {string[]} allowedResources
     *
     * @param {GetRequestedResourceAsyncParams}
     */
    async getRequestedResourceAsync({ scope, searchParams, allowedResources }) {
        if (scope) {
            let allowedResourcesByScopes = [];

            // check allowed resource by scope
            for (const scope1 of scope.split(' ')) {
                if (scope1.startsWith('user')) {
                    // ex: user/Patient.*
                    const inner_scope = scope1.replace('user/', '');
                    const [resource, accessType] = inner_scope.split('.');
                    if (accessType === '*' || accessType === 'read') {
                        if (resource === '*') {
                            allowedResourcesByScopes = null;
                            break;
                        }
                        allowedResourcesByScopes.push(resource);
                    }
                }
            }

            if (allowedResourcesByScopes) {
                allowedResources = allowedResources.filter((resource) =>
                    allowedResourcesByScopes.includes(resource)
                );
            }
        }

        // do not allow auditEvent export
        allowedResources = allowedResources.filter(r => r !== 'AuditEvent');

        if (searchParams.has('_type')) {
            const requestResources = searchParams.get('_type').split(',');

            let errors = '';
            allowedResources = requestResources.filter((resource) => {
                if (allowedResources.includes(resource)) {
                    return true;
                }

                const operationOutcome = new OperationOutcome({
                    resourceType: 'OperationOutcome',
                    issue: [
                        new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'forbidden',
                            details: { text: `Cannot access ${resource} with scope ${scope}` },
                            diagnostics: `Cannot access ${resource} with scope ${scope}`
                        })
                    ]
                });
                errors += `${JSON.stringify(operationOutcome)}\n`;

                return false;
            });

            // if there are errors write to s3
            if (errors) {
                const filePath = `${this.baseS3Folder}/OperationOutcome.ndjson`;

                await this.s3Client.uploadAsync({
                    filePath,
                    data: errors
                });

                // Add errors to ExportStatus resource and update in database
                this.exportStatusResource.errors.push(
                    new ExportStatusEntry({
                        type: 'OperationOutcome',
                        url: this.s3Client.getPublicFilePath(filePath)
                    })
                );
            }
        }

        return allowedResources;
    }

    /**
     * Builds a Mongo projection for _elements, or null when _elements is absent.
     * Reuses searchManager.handleElementsQuery (same seam as search) to validate the
     * requested elements against the resource and build the base projection, then forces
     * the FHIR-mandatory fields so the emitted doc stays a valid resource: resourceType,
     * id, meta, plus _uuid. On the projected path we skip enrichment/attachment transforms,
     * so only what is projected is emitted (no stripped/omitted content is re-expanded).
     *
     * @typedef {Object} BuildElementsProjectionParams
     * @property {string} resourceType
     * @property {URLSearchParams} searchParams
     *
     * @param {BuildElementsProjectionParams}
     * @returns {import('mongodb').Document|null}
     */
    buildElementsProjection({ resourceType, searchParams }) {
        if (!searchParams.has('_elements')) {
            return null;
        }
        const parsedArgs = this.r4ArgsParser.parseArgs({
            resourceType,
            args: { base_version: '4_0_0', _elements: searchParams.get('_elements') }
        });
        if (!parsedArgs._elements) {
            return null;
        }
        // handleElementsQuery validates each requested element and mutates options.projection.
        const { options } = this.searchManager.handleElementsQuery({
            parsedArgs,
            columns: new Set(),
            resourceType,
            options: {},
            useAccessIndex: false
        });
        const projection = options.projection || {};
        // Drop any meta sub-paths handleElementsQuery added (e.g. meta.security.system):
        // Mongo rejects a path collision between `meta` and `meta.<sub>` in one projection.
        for (const key of Object.keys(projection)) {
            if (key.startsWith('meta.')) {
                delete projection[key];
            }
        }
        // Force FHIR-mandatory fields so the emitted doc is a valid resource.
        projection.resourceType = 1;
        projection.id = 1;
        projection.meta = 1;
        projection._uuid = 1;
        return projection;
    }

    /**
     * Turns a raw Mongo export doc into a serialized NDJSON-ready object.
     * Full export (no projection) hydrates + enriches + attachment-transforms as before.
     * The projected (_elements) path skips those re-expansions and serializes the doc
     * as fetched; the resource serializer drops Mongo-internal fields (_uuid, _sourceId, ...).
     *
     * Raw-elements contract: with enrichment skipped, reference-valued elements are emitted
     * in their raw stored (uuid) form, not the enrichment-rewritten form a full export gives.
     * Edge case: a resource whose stored top-level `id` differs from `_sourceId` (data ingested
     * in global-id form) can yield a different `id` under `_elements=id` than a full export,
     * since IdEnrichmentProvider rewrites id from _sourceId only on the full path.
     *
     * @typedef {Object} SerializeExportDocParams
     * @property {Object} doc - raw Mongo document
     * @property {string} resourceType
     * @property {ParsedArgs} parsedArgs
     * @property {boolean} isProjected
     *
     * @param {SerializeExportDocParams}
     * @returns {Promise<Object>}
     */
    async serializeExportDoc({ doc, resourceType, parsedArgs, isProjected }) {
        const resource = FhirResourceCreator.createByResourceType(doc, resourceType);
        if (!isProjected) {
            await this.enrichmentManager.enrichAsync({ resources: [resource], parsedArgs });
            await this.databaseAttachmentManager.transformAttachments({
                resource,
                operation: GRIDFS.RETRIEVE
            });
        }
        return FhirResourceSerializer.serialize(resource.toJSONInternal());
    }

    /**
     * Adds patient related filters to the query
     * @typedef {Object} AddPatientFiltersToQueryParams
     * @property {string[]} patientReferences
     * @property {Object} query
     * @property {string} resourceType
     *
     * @param {AddPatientFiltersToQueryParams}
     */
    addPatientFiltersToQuery({ patientReferences, query, resourceType }) {
        if (patientReferences && patientReferences.length > 0) {
            const uuidReferences = patientReferences.filter((r) => isUuid(r));

            const nonUuidReferences = patientReferences.filter((r) => !isUuid(r));

            let andQuery;
            if (resourceType === 'Patient') {
                andQuery = {
                    $or: [
                        {
                            _uuid: {
                                $in: uuidReferences.map(
                                    (r) => ReferenceParser.parseReference(r).id
                                )
                            }
                        },
                        {
                            _sourceId: {
                                $in: nonUuidReferences.map(
                                    (r) => ReferenceParser.parseReference(r).id
                                )
                            }
                        }
                    ]
                };
            } else if (resourceType.startsWith("Subscription")) {
                let patientSubscriptionFilter = {
                    Subscription: 'extension',
                    SubscriptionStatus: 'extension',
                    SubscriptionTopic: 'identifier'
                };

                let patientIds = patientReferences.map(r => ReferenceParser.parseReference(r).id);

                andQuery = {
                    [patientSubscriptionFilter[resourceType]]: {
                        $elemMatch: {
                            [SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[
                                patientSubscriptionFilter[resourceType]
                            ]['key']]: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient,
                            [SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[
                                patientSubscriptionFilter[resourceType]
                            ]['value']]: {
                                $in: patientIds
                            }
                        }
                    }
                };
            } else {
                let patientField = this.patientFilterManager.getPatientPropertyForResource({
                    resourceType
                });

                if (!patientField){
                    patientField = this.patientFilterManager.getPatientPropertyForPersonScopedResource({
                        resourceType
                    });
                }

                andQuery = {
                    [patientField.replace('.reference', '._uuid')]: {
                        $in: patientReferences
                    }
                };
            }

            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({ query, andQuery });
        }

        return query;
    }

    /**
     * Derives the caller tenant scope for the export from the stored scope.
     * Reuses the same seam the base export query uses (SecurityTagManager /
     * ScopesManager on the injected searchManager), so roster tenant filtering
     * matches the MongoDB compartment filtering. `hasFullAccess` is the `*`
     * access code (never hardcoded); access tags are the concrete codes.
     *
     * @returns {{accessTags: string[], ownerTags: string[], hasFullAccess: boolean}}
     */
    getExportSecurityContext() {
        const user = this.exportStatusResource.user;
        const scope = this.exportStatusResource.scope;
        const accessCodes = this.searchManager.scopesManager.getAccessCodesFromScopes('read', user, scope);
        const hasFullAccess = accessCodes.includes('*');
        // getSecurityTagsFromScope returns [] for full-access (`*`) scopes and the
        // concrete access codes otherwise. Owner tags are not encoded in scopes.
        const accessTags = this.searchManager.securityTagManager.getSecurityTagsFromScope({
            user, scope, accessRequested: 'read'
        });
        return { accessTags, ownerTags: [], hasFullAccess };
    }

    /**
     * Loads the Group and resolves its member Patient references for export.
     * Hybrid Groups (ClickHouse roster) are paged via the storage provider with the
     * caller tenant scope; normal Groups read inline Group.member[]. Returns [] when
     * the caller cannot see the Group (no leak).
     *
     * @typedef {Object} GetGroupMemberPatientReferencesAsyncParams
     * @property {string} groupId
     * @property {Object} query - Tenant-scoped base export query
     *
     * @param {GetGroupMemberPatientReferencesAsyncParams}
     * @returns {Promise<string[]>}
     */
    async getGroupMemberPatientReferencesAsync({ groupId, query }) {
        // The group id arrives from the request URL. Derive the value used in the datastore query
        // from a validating regex match (a bounded FHIR id/uuid token) rather than the raw input,
        // so an operator-object can never reach findOne (fail fast on anything else).
        const groupIdMatch = typeof groupId === 'string' && groupId.match(/^[A-Za-z0-9\-.]{1,64}$/);
        if (!groupIdMatch) {
            throw new BadRequestError(new Error('Invalid Group id for $export'));
        }
        const safeGroupId = groupIdMatch[0];

        // Load the Group with the export's tenant scope so an unauthorized caller sees nothing.
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
            resourceType: 'Group',
            base_version: '4_0_0'
        });
        const collection = await resourceLocator.getCollectionAsync({});
        const groupQuery = this.r4SearchQueryCreator.appendAndSimplifyQuery({
            query: deepcopy(query),
            andQuery: { $or: [{ _uuid: safeGroupId }, { _sourceId: safeGroupId }] }
        });
        // Reviewed false positive: groupId is a URL path segment (always a string), validated and
        // derived from a bounded FHIR-id regex match above, so a NoSQL operator-object cannot reach
        // this query. Aikido's taint engine flags the URL->findOne flow regardless of that. See EA-2331.
        const groupDoc = await collection.findOne(groupQuery); // nosec

        if (!groupDoc) {
            logInfo(`Group not found or not authorized for export: ${groupId}`);
            return [];
        }

        const hasExternalMembers = hasExternalStorageMemberTag(groupDoc);
        const clickHouseGroupsEnabled =
            this.searchManager.configManager.enableClickHouse &&
            this.searchManager.configManager.mongoWithClickHouseResources.includes('Group');

        // Roster lives in ClickHouse but ClickHouse is off: the inline member[] was stripped,
        // so falling through would silently export nothing. Fail loudly instead.
        if (hasExternalMembers && !clickHouseGroupsEnabled) {
            throw new Error(
                `Group ${groupId} has externally-stored membership but ClickHouse is disabled; ` +
                'cannot resolve members for export.'
            );
        }

        if (!hasExternalMembers) {
            // Normal Group: members are inline in Mongo.
            return (groupDoc.member || [])
                .map(m => m?.entity?.reference)
                .filter(ref => ref && ref.startsWith('Patient/'));
        }

        // Hybrid Group: page the ClickHouse roster with the caller tenant scope.
        const securityContext = this.getExportSecurityContext();
        const groupProvider = this.storageProviderFactory.createProvider({
            resourceType: 'Group',
            base_version: '4_0_0'
        });

        const references = [];
        const pageSize = this.patientReferenceBatchSize || 100;
        let afterReference = null;
        // Roster events are keyed on the Group's resource id (see clickHouseGroupHandler).
        const rosterGroupId = groupDoc.id;
        // Seek pagination over the roster (members-only page, no per-page count); keep Patient members.
        for (;;) {
            const members = await groupProvider.getActiveMembersPageAsync(
                rosterGroupId,
                { limit: pageSize, afterReference },
                securityContext
            );
            if (!members || members.length === 0) {
                break;
            }
            for (const member of members) {
                if (member.entity_type === 'Patient' && member.entity_reference) {
                    references.push(member.entity_reference);
                }
            }
            if (members.length < pageSize) {
                break;
            }
            afterReference = members[members.length - 1].entity_reference;
        }

        return references;
    }

    /**
     * @typedef {Object} HandlePatientExportAsyncParams
     * @property {URLSearchParams} searchParams
     * @property {Object} query
     * @property {string} resourceType
     * @property {string[]} [memberPatientReferences] - When provided (Group export), scopes
     *   the export to these Patient references instead of the `patient` search param.
     * @property {boolean} [isGroupExport] - True for Group-level exports. An empty member
     *   set then yields an empty output (never a tenant-wide fallback).
     *
     * @param {HandlePatientExportAsyncParams}
     */
    async handlePatientExportAsync({ searchParams, query, resourceType, memberPatientReferences, isGroupExport = false }) {
        try {
            logInfo(`Starting export for resource: ${resourceType}`);

            // Group export with no resolvable members: write an empty file and stop.
            // Falling through would drop the patient filter and export the whole tenant.
            if (isGroupExport && (!memberPatientReferences || memberPatientReferences.length === 0)) {
                const emptyFilePath = `${this.baseS3Folder}/${resourceType}.ndjson`;
                await this.s3Client.uploadEmptyFileAsync({ filePath: emptyFilePath });
                this.exportStatusResource.output.push(
                    new ExportStatusEntry({
                        type: resourceType,
                        url: this.s3Client.getPublicFilePath(emptyFilePath)
                    })
                );
                return;
            }

            // Create patient query and get cursor to process patients batchwise
            const patientQuery = this.addPatientFiltersToQuery({
                patientReferences: memberPatientReferences || searchParams.get('patient')?.split(','),
                query: deepcopy(query),
                resourceType: 'Patient'
            });

            if (resourceType === 'Patient') {
                await this.processResourceAsync({ resourceType, query: patientQuery, searchParams });
                return;
            }

            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const collection = await resourceLocator.getCollectionAsync({});

            const options = { projection: { _uuid: 1 }, batchSize: this.fetchResourceBatchSize };
            const patientCursor = collection.find(patientQuery, options);

            const multipartContext = new S3MultiPartContext({
                resourceFilePath: `${this.baseS3Folder}/${resourceType}.ndjson`
            });
            // _elements projection (if any) applies to the exported resource type, not the
            // Patient-reference lookup above (which only needs _uuid).
            const elementsProjection = this.buildElementsProjection({ resourceType, searchParams });

            let patientReferences = [];
            for await (const result of patientCursor) {
                patientReferences.push(`Patient/${result._uuid}`);

                if (patientReferences.length === this.patientReferenceBatchSize) {
                    await this.exportPatientDataAsync({
                        resourceType,
                        query,
                        patientReferences,
                        multipartContext,
                        elementsProjection
                    });
                    patientReferences = [];
                }
            }

            if (patientReferences.length > 0) {
                await this.exportPatientDataAsync({
                    resourceType,
                    query,
                    patientReferences,
                    multipartContext,
                    elementsProjection
                });
            }

            if (multipartContext.previousBuffer?.length) {
                logInfo(`${resourceType} resource read: ${multipartContext.readCount}`);
                logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);

                // Upload the file to s3
                multipartContext.multipartUploadParts.push(
                    await this.s3Client.uploadPartAsync({
                        data: multipartContext.previousBuffer.join('\n').trim(),
                        partNumber: multipartContext.multipartUploadParts.length + 1,
                        uploadId: multipartContext.uploadId,
                        filePath: multipartContext.resourceFilePath
                    })
                );

                logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);
            }
            if (multipartContext.uploadId) {
                // finish multipart upload
                await this.s3Client.completeMultiPartUploadAsync({
                    filePath: multipartContext.resourceFilePath,
                    uploadId: multipartContext.uploadId,
                    multipartUploadParts: multipartContext.multipartUploadParts
                });
            } else {
                // Upload an empty file as we cannot upload empty file using multipart upload if no data present to be uploaded
                await this.s3Client.uploadEmptyFileAsync({ filePath: multipartContext.resourceFilePath });
            }

            // add filename to ExportStatus resource
            this.exportStatusResource.output.push(
                new ExportStatusEntry({
                    type: resourceType,
                    url: this.s3Client.getPublicFilePath(multipartContext.resourceFilePath)
                })
            );

            logInfo(`Finished exporting ${resourceType} resource`);
        } catch (err) {
            logError(`Error in handlePatientExportAsync: ${err.message}`, {
                error: err.stack,
                query
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.handlePatientExportAsync',
                error: err,
                args: {
                    query
                }
            });
        }
    }

    /**
     * @typedef {Object} ExportPatientDataAsyncParams
     * @property {string} resourceType
     * @property {Object} query
     * @property {string[]} patientReferences
     * @property {Object} multipartContext
     * @property {import('mongodb').Document|null} [elementsProjection] - When set (_elements),
     *   restricts the fetch to these fields and skips enrichment/attachment transforms.
     *
     * @param {ExportPatientDataAsyncParams}
     */
    async exportPatientDataAsync({
        resourceType,
        query,
        patientReferences,
        multipartContext,
        elementsProjection = null
    }) {
        const resourceQuery = this.addPatientFiltersToQuery({
            patientReferences,
            query: deepcopy(query),
            resourceType
        });
        try {
            logDebug(`Exporting ${resourceType} resources with query: ${JSON.stringify(resourceQuery)}`);

            // generate parsed args for enriching the resource
            const parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version: '4_0_0'
                }
            });
            parsedArgs.headers = {};

            if (!multipartContext.collection) {
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                    resourceType,
                    base_version: '4_0_0'
                });
                const db = await resourceLocator.getDatabaseConnectionAsync();
                multipartContext.collection = db.collection(`${resourceType}_4_0_0`);
                const stats = await db.command({ collStats: `${resourceType}_4_0_0` });
                multipartContext.averageDocumentSize = stats.avgObjSize > 0 ? stats.avgObjSize : 2000;
            }

            const options = { batchSize: this.fetchResourceBatchSize };
            if (elementsProjection) {
                options.projection = elementsProjection;
            }
            const cursor = multipartContext.collection.find(resourceQuery, options);

            // start multipart upload
            if (!multipartContext.uploadId && await cursor.hasNext()) {
                multipartContext.uploadId = await this.s3Client.createMultiPartUploadAsync({
                    filePath: multipartContext.resourceFilePath
                });
                logInfo(`Starting multipart upload for ${resourceType} with uploadId ${multipartContext.uploadId}`);
            }
            const minUploadBatchSize = Math.floor(this.uploadPartSize / multipartContext.averageDocumentSize);
            while (await cursor.hasNext()) {
                const currentBatch = new Array(minUploadBatchSize);
                let currentBatchSize = 0;
                while (await cursor.hasNext() && currentBatchSize < minUploadBatchSize) {
                    const doc = await this.serializeExportDoc({
                        doc: await cursor.next(),
                        resourceType,
                        parsedArgs,
                        isProjected: Boolean(elementsProjection)
                    });
                    currentBatch[currentBatchSize++] = JSON.stringify(doc);
                }

                multipartContext.readCount += currentBatchSize;
                if (multipartContext.previousBuffer?.length) {
                    currentBatch.concat(multipartContext.previousBuffer);
                    currentBatchSize += multipartContext.previousBatchSize;
                }
                if (currentBatchSize >= minUploadBatchSize) {
                    logInfo(`${resourceType} resource read: ${multipartContext.readCount}`);
                    logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);

                    // Upload the file to s3
                    multipartContext.multipartUploadParts.push(
                        await this.s3Client.uploadPartAsync({
                            data: currentBatch.slice(0, currentBatchSize).join('\n'),
                            partNumber: multipartContext.multipartUploadParts.length + 1,
                            uploadId: multipartContext.uploadId,
                            filePath: multipartContext.resourceFilePath
                        })
                    );
                    multipartContext.previousBuffer = null;
                    multipartContext.previousBatchSize = null;

                    logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);
                } else {
                    multipartContext.previousBuffer = currentBatch;
                    multipartContext.previousBatchSize = currentBatchSize;
                }
            }
        } catch (err) {
            logError(`Error in exportPatientDataAsync: ${err.message}`, {
                error: err.stack,
                resourceQuery
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.exportPatientDataAsync',
                error: err,
                args: {
                    resourceQuery
                }
            });
        }
    }

    /**
     * Process export for the provided resource
     * @typedef {Object} ProcessResourceAsyncParams
     * @property {string} resourceType
     * @property {Object} query
     * @property {number} [batchNumber]
     * @property {URLSearchParams} [searchParams] - Source of the optional _elements projection.
     *
     * @param {ProcessResourceAsyncParams}
     */
    async processResourceAsync({ resourceType, query, batchNumber, searchParams }) {
        const filePath = `${this.baseS3Folder}/${resourceType}${batchNumber ? `_${batchNumber}` : ''}.ndjson`;
        let uploadId;
        try {
            logDebug(`Exporting ${resourceType} resource with query: ${JSON.stringify(query)}`);

            // generate parsed args for enriching the resource
            const parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version: '4_0_0'
                }
            });
            parsedArgs.headers = {};

            // _elements: project to requested + mandatory fields and skip enrichment/attachment.
            const elementsProjection = searchParams
                ? this.buildElementsProjection({ resourceType, searchParams })
                : null;

            logInfo(`Exporting resources for ${resourceType} resource`);

            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType,
                base_version: '4_0_0'
            });

            const db = await resourceLocator.getDatabaseConnectionAsync();
            const options = { batchSize: this.fetchResourceBatchSize };
            if (elementsProjection) {
                options.projection = elementsProjection;
            }
            const cursor = db.collection(`${resourceType}_4_0_0`).find(query, options);

            let readCount = 0;

            // start multipart upload
            if (await cursor.hasNext()) {
                uploadId = await this.s3Client.createMultiPartUploadAsync({ filePath });
                logInfo(`Starting multipart upload for ${resourceType} with uploadId ${uploadId}`);
            }
            const multipartUploadParts = [];

            const stats = await db.command({ collStats: `${resourceType}_4_0_0` });
            const minUploadBatchSize = Math.floor(this.uploadPartSize / stats.avgObjSize);
            while (await cursor.hasNext()) {
                const currentBatch = new Array(minUploadBatchSize);
                let currentBatchSize = 0;

                while (await cursor.hasNext() && currentBatchSize < minUploadBatchSize) {
                    const doc = await this.serializeExportDoc({
                        doc: await cursor.next(),
                        resourceType,
                        parsedArgs,
                        isProjected: Boolean(elementsProjection)
                    });
                    currentBatch[currentBatchSize++] = JSON.stringify(doc);
                }

                const buffer = currentBatch.slice(0, currentBatchSize).join('\n');

                readCount += currentBatchSize;
                logInfo(`${resourceType} resource read: ${readCount}`);
                logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${uploadId}`);

                // Upload the file to s3
                multipartUploadParts.push(
                    await this.s3Client.uploadPartAsync({
                        data: buffer,
                        partNumber: multipartUploadParts.length + 1,
                        uploadId,
                        filePath
                    })
                );

                logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${uploadId}`);
            }

            if (uploadId) {
                // finish multipart upload
                await this.s3Client.completeMultiPartUploadAsync({
                    filePath,
                    uploadId,
                    multipartUploadParts
                });
            } else {
                // Upload an empty file as we cannot upload empty file using multipart upload if no data present to be uploaded
                await this.s3Client.uploadEmptyFileAsync({ filePath });
            }

            // add filename to ExportStatus resource
            this.exportStatusResource.output.push(
                new ExportStatusEntry({
                    type: resourceType,
                    url: this.s3Client.getPublicFilePath(filePath)
                })
            );

            logInfo(`Finished exporting ${resourceType} resource`);
        } catch (err) {
            if (uploadId) {
                await this.s3Client.abortMultiPartUploadAsync({ filePath, uploadId });
            }
            logError(`Error in processResourceAsync: ${err.message}`, {
                error: err.stack,
                resourceType,
                query
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.processResourceAsync',
                error: err,
                args: {
                    resourceType,
                    query
                }
            });
        }
    }
}

module.exports = { BulkDataExportRunner };
