/**
 * This file contains functions to retrieve a graph of data from the database
 */
const async = require('async');
const {R4SearchQueryCreator} = require('../query/r4');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {SecurityTagManager} = require('../common/securityTagManager');
const {ResourceEntityAndContained} = require('./resourceEntityAndContained');
const {NonResourceEntityAndContained} = require('./nonResourceEntityAndContained');
const {ScopesManager} = require('../security/scopesManager');
const {ScopesValidator} = require('../security/scopesValidator');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {ConfigManager} = require('../../utils/configManager');
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {RethrownError} = require('../../utils/rethrownError');
const {SearchManager} = require('../search/searchManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleRequest = require('../../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const {EnrichmentManager} = require('../../enrich/enrich');
const {R4ArgsParser} = require('../query/r4ArgsParser');
const {ParsedArgs} = require('../query/parsedArgs');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ReferenceParser} = require('../../utils/referenceParser');
const {QueryItem} = require('./queryItem');
const {ProcessMultipleIdsAsyncResult} = require('../common/processMultipleIdsAsyncResult');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');
const GraphDefinition = require('../../fhir/classes/4_0_0/resources/graphDefinition');
const ResourceContainer = require('../../fhir/classes/4_0_0/simple_types/resourceContainer');
const {logError} = require('../common/logging');
const {sliceIntoChunks} = require('../../utils/list.util');
const {ResourceIdentifier} = require('../../fhir/resourceIdentifier');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
const {
    GRIDFS: {RETRIEVE},
    OPERATIONS: {READ},
    SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP,
    PATIENT_REFERENCE_PREFIX,
    PERSON_REFERENCE_PREFIX,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    PERSON_PROXY_PREFIX
} = require('../../constants');
const {isValidResource} = require('../../utils/validResourceCheck');
const {SearchParametersManager} = require('../../searchParameters/searchParametersManager');
const {NestedPropertyReader} = require('../../utils/nestedPropertyReader');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const nonClinicalDataFields = require('../../graphs/patient/generated.non_clinical_resources_fields.json');
const {SearchBundleOperation} = require('../search/searchBundle');
const { RemoveHelper } = require('../remove/removeHelper');
const clinicalResources = require('../../graphs/patient/generated.clinical_resources.json')['clinicalResources'];
const nonClinicalResources = require('../../graphs/patient/generated.clinical_resources.json')['nonClinicalResources'];

/**
 * This class helps with creating graph responses
 */
class GraphHelper {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SecurityTagManager} securityTagManager
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {SearchManager} searchManager
     * @param {EnrichmentManager} enrichmentManager
     * @param {R4ArgsParser} r4ArgsParser
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {SearchParametersManager} searchParametersManager
     * @param {SearchBundleOperation} searchParametersOperation
     * @param {RemoveHelper} removeHelper
     */
    constructor({
                    databaseQueryFactory,
                    securityTagManager,
                    scopesManager,
                    scopesValidator,
                    configManager,
                    bundleManager,
                    resourceLocatorFactory,
                    r4SearchQueryCreator,
                    searchManager,
                    enrichmentManager,
                    r4ArgsParser,
                    databaseAttachmentManager,
                    searchParametersManager,
                    searchBundleOperation,
                    removeHelper
                }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {SearchParametersManager}
         */
        this.searchParametersManager = searchParametersManager;
        assertTypeEquals(searchParametersManager, SearchParametersManager);

        /**
         * @type {SearchBundleOperation}
         */
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);

        /**
         * @type {RemoveHelper}
         */
        this.removeHelper = removeHelper;
        assertTypeEquals(removeHelper, RemoveHelper);
    }

    /**
     * returns property values
     * @param {EntityAndContainedBase} entity
     * @param {string} property Property to read
     * @param {string?} filterProperty Filter property (optional)
     * @param {string?} filterValue Filter value (optional)
     * @returns {Object[]}
     */
    getPropertiesForEntity({entity, property, filterProperty, filterValue}) {
        const item = (entity instanceof ResourceEntityAndContained) ? entity.resource : entity.item;
        if (property.includes('.')) { // this is a nested property so recurse down and find the value
            /**
             * @type {string[]}
             */
            const propertyComponents = property.split('.');
            /**
             * @type {Object[]}
             */
            let currentElements = [item];
            for (const propertyComponent of propertyComponents) {
                // find nested elements where the property is present and select the property
                currentElements = currentElements.filter(c => c[`${propertyComponent}`]).flatMap(c => c[`${propertyComponent}`]);
                if (currentElements.length === 0) {
                    return [];
                }
            }
            // if there is a filter then check that the last element has that value
            if (filterProperty) {
                currentElements = currentElements.filter(c => c[`${filterProperty}`] && c[`${filterProperty}`] === filterValue);
            }
            return currentElements;
        } else {
            return [item[`${property}`]];
        }
    }

    /**
     * retrieves references from the provided property.
     * Always returns an array of references whether the property value is an array or just an object
     * @param {Object || Object[]} propertyValue
     * @param {boolean} supportLegacyId
     * @return {string[]}
     */
    getReferencesFromPropertyValue({propertyValue, supportLegacyId = true}) {
        if (this.configManager.supportLegacyIds && supportLegacyId) {
            // concat uuids and ids so we can search both in case some reference does not have
            // _sourceAssigningAuthority set correctly
            return Array.isArray(propertyValue)
                ? propertyValue.map(a => a._uuid).concat(propertyValue.map(a => a.reference))
                : [].concat([propertyValue._uuid]).concat([propertyValue.reference]);
        } else {
            return Array.isArray(propertyValue)
                ? propertyValue.map(a => a._uuid)
                : [].concat([propertyValue._uuid]);
        }
    }

    /**
     * returns whether this property is a reference (by checking if it has a reference sub property)
     * @param {EntityAndContainedBase[]} entities
     * @param {string} property
     * @param {string?} filterProperty
     * @param {string?} filterValue
     * @param {boolean} supportLegacyId
     * @returns {boolean}
     */
    isPropertyAReference({entities, property, filterProperty, filterValue, supportLegacyId = true}) {
        /**
         * @type {EntityAndContainedBase}
         */
        for (const entity of entities) {
            /**
             * @type {*[]}
             */
            const propertiesForEntity = this.getPropertiesForEntity({
                entity, property, filterProperty, filterValue
            });
            const references = propertiesForEntity
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r, supportLegacyId}))
                .filter(r => r !== undefined && r !== null);

            if (references && references.length > 0) { // if it has a 'reference' property then it is a reference
                return true; // we assume that if one entity has it then all entities can since they are of same type
            }
        }
        return false;
    }

    /**
     * Gets related resources and adds them to containedEntries in parentEntities
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {EntityAndContainedBase[]} parentEntities
     * @param {string} property
     * @param {string | null} filterProperty (Optional) filter the sublist by this property
     * @param {*|null} filterValue (Optional) match filterProperty to this value
     * @param {ParsedArgs} parseArgs
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {boolean} supportLegacyId
     * @returns {QueryItem}
     */
    async getForwardReferencesAsync({
                                        requestInfo,
                                        base_version,
                                        resourceType,
                                        parentEntities,
                                        property,
                                        filterProperty,
                                        filterValue,
                                        parsedArgs,
                                        explain,
                                        debug,
                                        supportLegacyId = true,
                                        params = {}
                                    }) {
        try {
            if (!parentEntities || parentEntities.length === 0 || !isValidResource(resourceType)) {
                return; // nothing to do
            }

            /**
             * Parent entities can contain duplicate objects as its functions are recursively called and
             * children of parents will be the parents for next level
             * @type {import('./entityAndContainedBase').EntityAndContainedBase[]}
             */
            const uniqueParentEntities = Array.from(new Set(parentEntities));

            // get values of this property from all the entities
            const relatedReferences = uniqueParentEntities.flatMap(p => this.getPropertiesForEntity({
                entity: p,
                property
            })
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r, supportLegacyId}))
                .filter(r => r !== undefined && r !== null));
            // select just the ids from those reference properties
            // noinspection JSCheckFunctionSignatures
            let relatedReferenceIds = relatedReferences.map(reference => {
                const {
                    id: referenceId,
                    resourceType: referenceResourceType,
                    sourceAssigningAuthority: referenceSourceAssigningAuthority
                } = ReferenceParser.parseReference(reference);
                // if sourceAssigningAuthority is present in reference (e.g., 'Patient/123|client')
                // then the uuid will be correct so no need to include.
                // otherwise (e.g., 'Patient/123' include reference id too to handle where the reference id
                // was not specified with sourceAssigningAuthority.
                return referenceResourceType === resourceType && !referenceSourceAssigningAuthority
                    ? referenceId : null;
            }).filter(i => i !== null);
            if (relatedReferenceIds.length === 0) {
                return; // nothing to do
            }
            // remove duplicates to speed up data access
            relatedReferenceIds = Array.from(new Set(relatedReferenceIds));
            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;
            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            // Start with base args and add the id parameter
            const args = Object.assign({
                base_version,
                _includeHidden: parsedArgs._includeHidden,
                id: relatedReferenceIds.join(',')
            });

            // Apply additional params if provided
            if (params && Object.keys(params).length > 0) {
                Object.assign(args, params);
            }

            const childParseArgs = this.r4ArgsParser.parseArgs(
                {
                    resourceType,
                    args
                }
            );
            const {
                /** @type {import('mongodb').Document}**/
                query // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                requestId: requestInfo.requestId,
                parsedArgs: childParseArgs,
                operation: READ
            });

            if (filterProperty) {
                query[`${filterProperty}`] = filterValue;
            }
            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            const databaseQueryManager = this.databaseQueryFactory.createQuery({resourceType, base_version});

            let cursor = await databaseQueryManager.findAsync({query, options});

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }

            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});
            const collectionName = cursor.getCollection();

            while (await cursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                let relatedResource = await cursor.next();

                if (relatedResource) {
                    // create a class to hold information about this resource
                    /**
                     * @type {ResourceEntityAndContained}
                     */
                    relatedResource = await this.databaseAttachmentManager.transformAttachments(
                        relatedResource, RETRIEVE
                    );
                    const relatedEntityAndContained = new ResourceEntityAndContained({
                        entityId: relatedResource.id,
                        entityUuid: relatedResource._uuid,
                        entityResourceType: relatedResource.resourceType,
                        includeInOutput: true,
                        resource: relatedResource,
                        containedEntries: []
                    });

                    // find matching parent and add to containedEntries
                    /**
                     * @type {string}
                     */
                    let idToSearch = `${relatedResource.resourceType}/${relatedResource._uuid}`;
                    /**
                     * @type {EntityAndContainedBase[]}
                     */
                    let matchingParentEntities = uniqueParentEntities.filter(
                        p =>
                            this.getPropertiesForEntity({
                                    entity: p,
                                    property
                                }
                            )
                                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r, supportLegacyId}))
                                .filter(r => r !== undefined && r !== null)
                                .includes(idToSearch));

                    if (this.configManager.supportLegacyIds && supportLegacyId && matchingParentEntities.length === 0) {
                        idToSearch = `${relatedResource.resourceType}/${relatedResource.id}`;
                        matchingParentEntities = uniqueParentEntities.filter(
                            p =>
                                this.getPropertiesForEntity({
                                        entity: p,
                                        property
                                    }
                                )
                                    .flatMap(r => this.getReferencesFromPropertyValue({
                                        propertyValue: r,
                                        supportLegacyId
                                    }))
                                    .filter(r => r !== undefined && r !== null)
                                    .includes(idToSearch));
                    }
                    if (matchingParentEntities.length === 0) {
                        /**
                         * @type {string}
                         */
                        const parentEntitiesString = uniqueParentEntities.map(p => `${p.resource.resourceType}/${p.resource._uuid}`).toString();
                        logError('Forward Reference: No match found for child entity ' +
                            `${relatedResource.resourceType}/${relatedResource._uuid} in parent entities ` +
                            `${parentEntitiesString} using property ${property}`, {});
                    }

                    // add it to each one since there can be multiple resources that point to the same related resource
                    for (const /** @type {EntityAndContainedBase} */ matchingParentEntity of matchingParentEntities) {
                        matchingParentEntity.containedEntries = matchingParentEntity.containedEntries.concat(relatedEntityAndContained);
                    }
                }
            }
            return new QueryItem(
                {
                    query,
                    resourceType,
                    collectionName,
                    property,
                    explanations
                }
            );
        } catch (e) {
            logError(`Error in getForwardReferencesAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: `Error in getForwardReferencesAsync(): ${resourceType}, ` +
                    `parents:${parentEntities.map(p => p.entityId)}, property=${property}`,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    resourceType,
                    parentEntities,
                    property,
                    filterProperty,
                    filterValue,
                    explain,
                    debug,
                    params
                }
            });
        }
    }

    /**
     * converts a query string into an args array
     * @param {string} resourceType
     * @param {string} queryString
     * @param {object} commonArgs
     * @return {ParsedArgs}
     */
    parseQueryStringIntoArgs({resourceType, queryString, commonArgs = {}}) {
        const args = {};
        Object.assign(args, commonArgs, Object.fromEntries(new URLSearchParams(queryString)));
        args.base_version = VERSIONS['4_0_0'];
        return this.r4ArgsParser.parseArgs(
            {
                resourceType,
                args
            }
        );
    }

    /**
     * Gets related resources using reverse link and add them to containedEntries in parentEntities
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} parentResourceType
     * @param {string} relatedResourceType
     * @param {EntityAndContainedBase[]}  parentEntities parent entities
     * @param {string | null} filterProperty (Optional) filter the sublist by this property
     * @param {*} filterValue (Optional) match filterProperty to this value
     * @param {string} reverse_filter Do a reverse link from child to parent using this property
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {boolean} supportLegacyId
     * @param {string[]} proxyPatientIds
     * @param {ParsedArgs} parseArgs
     * @param {ResourceEntityAndContained[]} proxyPatientResources
     * @returns {QueryItem}
     */
    async getReverseReferencesAsync({
                                        requestInfo,
                                        base_version,
                                        parentResourceType,
                                        relatedResourceType,
                                        parentEntities,
                                        filterProperty,
                                        filterValue,
                                        reverse_filter,
                                        explain,
                                        debug,
                                        parsedArgs,
                                        supportLegacyId = true,
                                        proxyPatientIds = [],
                                        proxyPatientResources = [],
                                        params = {}
                                    }) {
        try {
            if (!(reverse_filter)) {
                throw new Error('reverse_filter must be set');
            }
            // Case when invalid relatedResourceType is passed.
            if (!isValidResource(relatedResourceType)) {
                return; // nothing to do
            }

            /**
             * Parent entities can contain duplicate objects as its functions are recursively called and
             * children of parents will be the parents for next level
             * @type {import('./entityAndContainedBase').EntityAndContainedBase}
             */
            const uniqueParentEntities = Array.from(new Set(parentEntities));
            // create comma separated list of references and ids
            /**
             * @type {string[]}
             */
            let parentResourceTypeAndIdList = uniqueParentEntities
                .filter(p => p.entityUuid !== undefined && p.entityUuid !== null)
                .map(p => `${p.resource.resourceType}/${p.entityUuid}`);
            /**
             * @type {string[]}
             */
            let parentResourceIdList = uniqueParentEntities
                .filter(p => p.entityUuid !== undefined && p.entityUuid !== null)
                .map(p => p.entityUuid);

            if (this.configManager.supportLegacyIds && supportLegacyId) {
                parentResourceTypeAndIdList = parentResourceTypeAndIdList.concat(
                    uniqueParentEntities
                        .filter(p => p.entityId !== undefined && p.entityId !== null)
                        .map(p => `${p.resource.resourceType}/${p.entityId}`)
                );
                parentResourceIdList = parentResourceIdList.concat(
                    uniqueParentEntities
                        .filter(p => p.entityId !== undefined && p.entityId !== null)
                        .map(p => p.entityId)
                );
            }

            if (parentResourceType === 'Patient' && proxyPatientIds) {
                parentResourceTypeAndIdList = parentResourceTypeAndIdList.concat(
                    proxyPatientIds.map((id) => PATIENT_REFERENCE_PREFIX + id)
                );
                parentResourceIdList = parentResourceIdList.concat(proxyPatientIds);
            }

            if (parentResourceTypeAndIdList.length === 0) {
                return;
            }
            /**
             * @type {string}
             */
            let reverseFilterWithParentIds = reverse_filter.replace('{ref}', parentResourceTypeAndIdList.join(','));
            reverseFilterWithParentIds = reverseFilterWithParentIds.replace('{id}', parentResourceIdList.join(','));

            /**
             * @type {ParsedArgs}
             */
            const relatedResourceParsedArgs = this.parseQueryStringIntoArgs(
                {
                    resourceType: relatedResourceType,
                    queryString: reverseFilterWithParentIds,
                    commonArgs: {
                        _includeHidden: parsedArgs._includeHidden
                    }
                }
            );
            const args = {};
            args.base_version = base_version;

            const searchParameterName = reverse_filter.split('=')[0];
            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync(
                {
                    user: requestInfo.user,
                    scope: requestInfo.scope,
                    isUser: requestInfo.isUser,
                    resourceType: relatedResourceType,
                    useAccessIndex,
                    personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                    requestId: requestInfo.requestId,
                    parsedArgs: relatedResourceParsedArgs,
                    operation: READ
                }
            );

            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;

            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: relatedResourceType,
                base_version
            });

            let cursor = await databaseQueryManager.findAsync({query, options});
            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

            // find matching field name in searchParameter list.  We will use this to match up to parent
            /**
             * @type {string}
             */
            const fieldForSearchParameter = this.searchParametersManager.getFieldNameForSearchParameter(relatedResourceType, searchParameterName);

            if (!fieldForSearchParameter) {
                throw new Error(`${searchParameterName} is not a valid search parameter for resource ${relatedResourceType}`);
            }

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }
            const collectionName = cursor.getCollection();

            while (await cursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                let relatedResourcePropertyCurrent = await cursor.next();
                if (relatedResourcePropertyCurrent) {
                    relatedResourcePropertyCurrent = await this.databaseAttachmentManager.transformAttachments(
                        relatedResourcePropertyCurrent, RETRIEVE
                    );
                    if (filterProperty !== null) {
                        if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                            continue;
                        }
                    }
                    // create the entry
                    const resourceEntityAndContained = new ResourceEntityAndContained({
                        entityId: relatedResourcePropertyCurrent.id,
                        entityUuid: relatedResourcePropertyCurrent._uuid,
                        entityResourceType: relatedResourcePropertyCurrent.resourceType,
                        includeInOutput: true,
                        resource: relatedResourcePropertyCurrent,
                        containedEntries: []
                    });
                    // now match to parent entity, so we can put under correct contained property
                    const properties = this.getPropertiesForEntity({
                        entity: resourceEntityAndContained, property: fieldForSearchParameter
                    });
                    // the reference property can be a single item or an array. Remove the sourceAssigningAuthority
                    // from references before matching.
                    /**
                     * @type {string[]}
                     */
                    let references = properties
                        .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r, supportLegacyId}))
                        .filter(r => r !== undefined).map(r => r.split('|')[0]);

                    // for handling case when searching using sourceid of proxy patient
                    /**
                     * @type {string[]}
                     */
                    let referenceWithSourceIds = [];
                    if (proxyPatientIds) {
                        referenceWithSourceIds = properties
                            .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                            .filter(r => r !== undefined).map(r => r.split('|')[0]);
                    }

                    // for handling case for subscription resources where instead of
                    // reference we only have id of person/patient resource in extension/identifier
                    if (
                        references.length === 0 &&
                        SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS.includes(fieldForSearchParameter)
                    ) {
                        properties.flat().map((r) => {
                            if (
                                r[
                                    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['key']
                                    ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person
                            ) {
                                references.push(
                                    PERSON_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['value']]
                                );
                            } else if (
                                r[
                                    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['key']
                                    ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient
                            ) {
                                references.push(
                                    PATIENT_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['value']]
                                );
                            }
                        });
                    }

                    /**
                     * @type {EntityAndContainedBase[]}
                     */
                    let matchingParentEntities = uniqueParentEntities.filter(
                        p => references.includes(`${p.resource.resourceType}/${p.resource._uuid}`));

                    if (this.configManager.supportLegacyIds && supportLegacyId && matchingParentEntities.length === 0) {
                        matchingParentEntities = uniqueParentEntities.filter(
                            p => references.includes(`${p.resource.resourceType}/${p.resource.id}`));
                    }
                    if (matchingParentEntities.length === 0) {
                        if (
                            parentResourceType === 'Patient' &&
                            proxyPatientIds &&
                            proxyPatientIds.some((id) =>
                                referenceWithSourceIds.includes(PATIENT_REFERENCE_PREFIX + id)
                            )
                        ) {
                            proxyPatientResources.push(resourceEntityAndContained);
                        } else {
                            const parentEntitiesString = uniqueParentEntities.map(
                                p => `${p.resource.resourceType}/${p.resource.id}`).toString();
                            logError(
                                `Reverse Reference: No match found for parent entities ${parentEntitiesString} ` +
                                `using property ${fieldForSearchParameter} in ` +
                                'child entity ' +
                                `${relatedResourcePropertyCurrent.resourceType}/${relatedResourcePropertyCurrent.id}`, {}
                            );
                        }
                    }

                    for (const matchingParentEntity of matchingParentEntities) {
                        matchingParentEntity.containedEntries.push(resourceEntityAndContained);
                    }
                }
            }
            return new QueryItem({
                    query,
                    resourceType: relatedResourceType,
                    collectionName,
                    reverse_filter,
                    explanations
                }
            );
        } catch (e) {
            logError(`Error in getReverseReferencesAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in getReverseReferencesAsync(): ' +
                    `parentResourceType: ${parentResourceType} relatedResourceType:${relatedResourceType}, ` +
                    `parents:${parentEntities.map(p => p.entityId)}, ` +
                    `filterProperty=${filterProperty}, filterValue=${filterValue}, ` +
                    `reverseFilter=${reverse_filter}`,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    parentResourceType,
                    relatedResourceType,
                    parentEntities,
                    filterProperty,
                    filterValue,
                    reverse_filter,
                    explain,
                    debug
                }
            });
        }
    }

    /**
     * returns whether the resource has the passed in property (handles nested properties)
     * @param {EntityAndContainedBase} entity
     * @param {string} property
     * @param {string} filterProperty
     * @param {string} filterValue
     * @returns {boolean}
     */
    doesEntityHaveProperty({entity, property, filterProperty, filterValue}) {
        const item = (entity instanceof ResourceEntityAndContained) ? entity.resource : entity.item;
        if (property.includes('.')) {
            /**
             * @type {string[]}
             */
            const propertyComponents = property.split('.');
            /**
             * @type {*[]}
             */
            let currentElements = [item];
            /**
             * @type {string}
             */
            for (const propertyComponent of propertyComponents) {
                // find nested elements where the property is present and select the property
                currentElements = currentElements.filter(c => c[`${propertyComponent}`]).flatMap(c => c[`${propertyComponent}`]);
                if (currentElements.length === 0) {
                    return false;
                }
            }
            // if there is a filter then check that the last element has that value
            if (filterProperty) {
                currentElements = currentElements.filter(c => c[`${filterProperty}`] && c[`${filterProperty}`] === filterValue);
                return (currentElements.length > 0);
            } else { // if not filter then just return true if we find the field
                return true;
            }
        } else {
            return item[`${property}`];
        }
    }

    /**
     * Parses the filter out of the property name
     * @param {string} property
     * @returns {{filterValue: string, filterProperty: string, property: string}}
     */
    getFilterFromPropertyPath(property) {
        /**
         * @type {string}
         */
        let filterProperty;
        /**
         * @type {string}
         */
        let filterValue;
        // if path is more complex and includes filter
        if (property.includes(':')) {
            /**
             * @type {string[]}
             */
            const property_split = property.split(':');
            if (property_split && property_split.length > 0) {
                /**
                 * @type {string}
                 */
                property = property_split[0];
                /**
                 * @type {string[]}
                 */
                const filterPropertySplit = property_split[1].split('=');
                if (filterPropertySplit.length > 1) {
                    /**
                     * @type {string}
                     */
                    filterProperty = filterPropertySplit[0];
                    /**
                     * @type {string}
                     */
                    filterValue = filterPropertySplit[1];
                }
            }
        }
        return {filterProperty, filterValue, property};
    }


    /**
     * process a link
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string|null} parentResourceType
     * @param {{path: string, params: string, target: {type: string}[]}} link
     * @param {EntityAndContainedBase[]} parentEntities
     * @param {boolean|null} explain
     * @param {boolean|null} debug
     * @param {{type: string}} target
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @param {string[]} proxyPatientIds
     * @param {ResourceEntityAndContained[]} proxyPatientResources
     * @return {Promise<{queryItems: QueryItem[], childEntries: EntityAndContainedBase[]}>}
     */
    async processLinkTargetAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            link,
            parentEntities,
            explain,
            debug,
            target,
            parsedArgs,
            supportLegacyId = true,
            proxyPatientIds = [],
            proxyPatientResources = []
        }
    ) {
        try {
            /**
             * @type {QueryItem[]}
             */
            let queryItems = [];
            /**
             * @type {EntityAndContainedBase[]}
             */
            let childEntries = [];
            /**
             * If this is not set then the caller does not want this entity but a nested entity
             * defined further in the GraphDefinition
             * @type {string | null}
             */
            const resourceType = target.type;
            // there are two types of linkages:
            // 1. forward linkage: a property in the current object is a reference to the target object (uses "path")
            // 2. reverse linkage: a property in the target object is a reference to the current object (uses "params")
            if (link.path) { // forward link
                /**
                 * @type {string}
                 */
                const originalProperty = link.path.replace('[x]', '');
                const {filterProperty, filterValue, property} = this.getFilterFromPropertyPath(originalProperty);
                // find parent entities that have a valid property
                parentEntities = parentEntities.filter(p => this.doesEntityHaveProperty({
                    entity: p, property, filterProperty, filterValue
                }));
                // if this is a reference then get related resources
                if (this.isPropertyAReference({
                    entities: parentEntities, property, filterProperty, filterValue, supportLegacyId
                })) {
                    if (this.scopesValidator.hasValidScopes({
                        requestInfo,
                        parsedArgs,
                        resourceType,
                        startTime: Date.now(),
                        action: 'graph',
                        accessRequested: 'read'
                    })) {
                        let targetParams = {};

                        // Parse target-level params
                        if (target.params) {
                            targetParams = this.parseTargetParams(target.params);
                        }

                        /**
                         * @type {QueryItem}
                         */
                        const queryItem = await this.getForwardReferencesAsync(
                            {
                                requestInfo,
                                base_version,
                                resourceType,
                                parentEntities,
                                property,
                                filterProperty,
                                filterValue,
                                explain,
                                debug,
                                supportLegacyId,
                                parsedArgs,
                                params: targetParams

                            }
                        );
                        if (queryItem) {
                            queryItems.push(queryItem);
                        }
                        childEntries = parentEntities.flatMap(p => p.containedEntries);
                    }
                } else { // handle paths that are not references
                    childEntries = [];
                    for (const parentEntity of parentEntities) {
                        // create child entries
                        /**
                         * @type {Object[]}
                         */
                        const children = this.getPropertiesForEntity({
                            entity: parentEntity, property, filterProperty, filterValue
                        });
                        /**
                         * @type {NonResourceEntityAndContained[]}
                         */
                        const childEntriesForCurrentEntity = children.map(c => new NonResourceEntityAndContained({
                            includeInOutput: target.type !== undefined, // if caller has requested this entity or just wants a nested entity
                            item: c,
                            containedEntries: []
                        }));
                        childEntries = childEntries.concat(childEntriesForCurrentEntity);
                        parentEntity.containedEntries = parentEntity.containedEntries.concat(childEntriesForCurrentEntity);
                    }
                }
            } else if (target.params) { // reverse link
                let targetParams = {};
                // Parse target-level params
                if (target.params) {
                    targetParams = this.parseTargetParams(target.params);
                }

                if (target.type) { // if caller has requested this entity or just wants a nested entity
                    // reverse link
                    if (this.scopesValidator.hasValidScopes({
                        requestInfo,
                        parsedArgs,
                        resourceType,
                        startTime: Date.now(),
                        action: 'graph',
                        accessRequested: 'read'
                    })) {
                        if (!parentResourceType) {
                            const parentEntitiesString = parentEntities.map(p => `${p.resource.resourceType}/${p.resource._uuid}`).toString();
                            logError(
                                'processOneGraphLinkAsync: No parent resource found for reverse references for ' +
                                `parent entities: ${parentEntitiesString} using target.params: ${target.params}`, {}
                            );
                        }
                        const queryItem = await this.getReverseReferencesAsync(
                            {
                                requestInfo,
                                base_version,
                                parentResourceType,
                                relatedResourceType: resourceType,
                                parentEntities,
                                filterProperty: null,
                                filterValue: null,
                                reverse_filter: target.params,
                                explain,
                                debug,
                                supportLegacyId,
                                proxyPatientIds,
                                proxyPatientResources,
                                parsedArgs,
                                params: targetParams
                            }
                        );
                        if (queryItem) {
                            queryItems.push(queryItem);
                        }
                        childEntries = parentEntities.flatMap(p => p.containedEntries);
                    }
                }
            }

            // filter childEntries to find entries of same type as parentResource
            childEntries = childEntries.filter(c => (!target.type && !c.resource) || // either there is no target type so choose non-resources
                (target.type && c.resource && c.resource.resourceType === target.type) // or there is a target type so match to it
            );
            if (childEntries && childEntries.length > 0) {
                /**
                 * @type {string|null}
                 */
                const childResourceType = target.type;

                // Now recurse down and process the link
                /**
                 * @type {[{path:string, params: string,target:[{type: string}]}]}
                 */
                const childLinks = target.link;
                if (childLinks) {
                    // now recurse and process the next link in GraphDefinition
                    /**
                     * @type {QueryItem[]}
                     */
                    const recursiveQueries = await async.flatMap(
                        childLinks,
                        async childLink => await this.processOneGraphLinkAsync(
                            {
                                requestInfo,
                                base_version,
                                parentResourceType: childResourceType,
                                link: childLink,
                                parentEntities: childEntries,
                                explain,
                                debug,
                                parsedArgs,
                                supportLegacyId,
                                proxyPatientIds,
                                proxyPatientResources
                            }
                        )
                    );
                    queryItems = queryItems.concat(recursiveQueries);
                }
            }
            return {queryItems, childEntries};
        } catch (e) {
            logError(`Error in processLinkTargetAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in processLinkTargetAsync(): ' + `parentResourceType: ${parentResourceType}, `,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    parentResourceType,
                    link,
                    parentEntities,
                    explain,
                    debug,
                    target
                }
            });
        }
    }

    /**
     * Parses link params string into an object of search parameters
     * @param {string|undefined} paramsString - Parameters string like "status=active&date=ge2023-01-01"
     * @returns {Object} - Object with parsed parameters
     */
    parseTargetParams(paramsString) {
        if (!paramsString || typeof paramsString !== 'string') {
            return {};
        }

        const params = {};
        try {
            // Handle URL query string format
            const searchParams = new URLSearchParams(paramsString);
            for (const [key, value] of searchParams) {
                params[key] = value;
            }
        } catch (error) {
            logError(`Error parsing link params: ${paramsString}`, {error});
        }

        return params;
    }

    /**
     * processes a single graph link
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string | null} parentResourceType
     * @param {{path: string, params: string, target: {type: string}[]}} link
     * @param {EntityAndContainedBase[]} parentEntities
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @param {string[]} proxyPatientIds
     * @param {ResourceEntityAndContained[]} proxyPatientResources
     * @returns {Promise<QueryItem[]>}
     */
    async processOneGraphLinkAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            link,
            parentEntities,
            explain,
            debug,
            parsedArgs,
            supportLegacyId = true,
            proxyPatientIds = [],
            proxyPatientResources = []
        }
    ) {
        try {
            /**
             * @type {{type: string}[]}
             */
            const link_targets = link.target;
            /**
             * @type {{queryItems: QueryItem[], childEntries: EntityAndContainedBase[]}[]}
             */
            const result = await async.map(
                link_targets,
                async (/** @type {type: string} */ target) => await this.processLinkTargetAsync(
                    {
                        requestInfo,
                        base_version,
                        parentResourceType,
                        link,
                        parentEntities,
                        explain,
                        debug,
                        target,
                        parsedArgs,
                        supportLegacyId,
                        proxyPatientIds,
                        proxyPatientResources
                    }
                )
            );
            /**
             * @type {QueryItem[]}
             */
            const queryItems = result.flatMap(r => r.queryItems);
            return queryItems;
        } catch (e) {
            logError(`Error in processOneGraphLinkAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in processOneGraphLinkAsync(): ' +
                    `parentResourceType: ${parentResourceType} , ` +
                    `parents:${parentEntities.map(p => p.entityId)}, `,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    parentResourceType,
                    link,
                    parentEntities,
                    explain,
                    debug
                }
            });
        }
    }

    /**
     * processes a list of graph links
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} parentResourceType
     * @param {Resource[]} parentResources
     * @param {{path:string, params: string,target:{type: string}[]}[]} linkItems
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @param {string[]} proxyPatientIds
     * @param {ResourceEntityAndContained[]} proxyPatientResources
     * @return {Promise<{entities: ResourceEntityAndContained[], queryItems: QueryItem[]}>}
     */
    async processGraphLinksAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            parentResources,
            linkItems,
            explain,
            debug,
            parsedArgs,
            supportLegacyId = true,
            proxyPatientIds = [],
            proxyPatientResources = []
        }
    ) {
        try {
            /**
             * @type {ResourceEntityAndContained[]}
             */
            const resultEntities = parentResources.map(parentResource => new ResourceEntityAndContained({
                entityId: parentResource.id,
                entityUuid: parentResource._uuid,
                entityResourceType: parentResource.resourceType,
                includeInOutput: true,
                resource: parentResource,
                containedEntries: []
            }));
            /**
             * @type {QueryItem[]}
             */
            const queryItems = await async.flatMap(
                linkItems,
                async (link) => await this.processOneGraphLinkAsync(
                    {
                        requestInfo,
                        base_version,
                        parentResourceType,
                        link,
                        parentEntities: resultEntities,
                        explain,
                        debug,
                        parsedArgs,
                        supportLegacyId,
                        proxyPatientIds,
                        proxyPatientResources
                    }
                )
            );
            return {entities: resultEntities, queryItems};
        } catch (e) {
            logError(`Error in processGraphLinksAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in processGraphLinksAsync(): ' +
                    `parentResourceType: ${parentResourceType} , ` +
                    `parents:${parentResources.map(p => p.id)}, `,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    parentResourceType,
                    parentEntities: parentResources,
                    linkItems,
                    explain,
                    debug
                }
            });
        }
    }

    /**
     * get all the contained entities recursively
     * @param {EntityAndContainedBase} entityAndContained
     * @returns {BundleEntry[]}
     */
    getRecursiveContainedEntities(entityAndContained) {
        /**
         * @type {BundleEntry[]}
         */
        let result = [];
        if (entityAndContained.includeInOutput && entityAndContained.resource && entityAndContained.resource.id) {
            // only include entities the caller has requested and are defined
            result.push({
                id: entityAndContained.resource.id,
                fullUrl: entityAndContained.fullUrl,
                resource: entityAndContained.resource
            });
        }

        // now recurse
        result.push(
            ...entityAndContained.containedEntries.flatMap((c) => this.getRecursiveContainedEntities(c))
        );
        return result;
    }

    /**
     * get all the non-clinical resources whose references are in the provided entity list
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource[]} resourceList
     * @param {string[]} resourcesToExclude
     * @param {ParsedArgs} parsedArgs
     * @param {string} base_version
     * @param {boolean} explain
     * @param {boolean} debug
     * @returns {Promise<{entities: BundleEntry[], queryItems: QueryItem[]}>}
     */
    async getLinkedNonClinicalResources(
        requestInfo,
        resourceList,
        resourcesToExclude,
        parsedArgs,
        base_version,
        explain,
        debug
    ) {
        try {
            /**
             * @type {BundleEntry[]}
             */
            let entities = [];
            /**
             * @type {QueryItem[]}
             */
            let queryItems = [];

            let nestedResourceReferences = {};

            for (const resource of resourceList) {
                let resourceNonClinicalDataFields = nonClinicalDataFields[resource.resourceType];
                for (const path of resourceNonClinicalDataFields ?? []) {
                    let references = NestedPropertyReader.getNestedProperty({
                        obj: resource,
                        path: path
                    });
                    if (references) {
                        if (!Array.isArray(references)) {
                            references = [references];
                        }
                        for (const reference of references) {
                            const {id: referenceId, resourceType: referenceResourceType} =
                                ReferenceParser.parseReference(reference);
                            if (
                                !resourcesToExclude.includes(referenceResourceType) &&
                                nonClinicalResources.includes(referenceResourceType)
                            ) {
                                if (nestedResourceReferences[referenceResourceType]) {
                                    nestedResourceReferences[referenceResourceType] =
                                        nestedResourceReferences[referenceResourceType].add(
                                            referenceId
                                        );
                                } else {
                                    nestedResourceReferences[referenceResourceType] = new Set([
                                        referenceId
                                    ]);
                                }
                            }
                        }
                    }
                }
            }

            for (const [resourceType, ids] of Object.entries(nestedResourceReferences)) {
                const args = {
                    base_version: base_version,
                    id: Array.from(ids).join(','),
                    _debug: debug,
                    _includeHidden: parsedArgs._includeHidden
                };
                if (explain) {
                    args['_count'] = 1;
                }

                const childParseArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args
                });

                const bundle = await this.searchBundleOperation.searchBundleAsync({
                    requestInfo,
                    resourceType,
                    parsedArgs: childParseArgs,
                    useAggregationPipeline: false
                });

                for (let entry of bundle.entry || []) {
                    entities.push({
                        id: entry.id,
                        resource: entry.resource
                    });
                }

                if (debug || explain) {
                    // making query items from meta of bundle
                    let query = bundle.meta.tag.find((obj) => {
                        return obj.system.endsWith('query');
                    }).display;
                    let collectionName = query.split('.')[1];
                    query = query.split('.find(')[1].split(', {}')[0];
                    query = JSON.parse(query.replace(/'/g, '"'));
                    let explanations = bundle.meta.tag.find((obj) => {
                        return obj.system.endsWith('queryExplain');
                    }).system;
                    queryItems.push(
                        new QueryItem({
                            query,
                            resourceType,
                            collectionName,
                            explanations
                        })
                    );
                }
            }

            entities = await this.enrichmentManager.enrichBundleEntriesAsync({
                entries: entities,
                parsedArgs
            });

            return {entities, queryItems};
        } catch (e) {
            logError(`Error in getLinkedNonClinicalResources(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: `Error in getLinkedNonClinicalResources()`,
                error: e,
                args: {
                    requestInfo,
                    resourceList,
                    resourcesToExclude,
                    parsedArgs,
                    base_version,
                    explain,
                    debug
                }
            });
        }
    }

    /**
     * processing multiple ids
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Resource} graphDefinition
     * @param {boolean} contained
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {ParsedArgs} parsedArgs
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {ResourceIdentifier[]} idsAlreadyProcessed
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @param {string[]} proxyPatientIds
     * @param {ResourceEntityAndContained[]} proxyPatientResources
     * @return {Promise<ProcessMultipleIdsAsyncResult>}
     */
    async processMultipleIdsAsync(
        {
            base_version,
            requestInfo,
            resourceType,
            graphDefinition,
            contained,
            explain,
            debug,
            parsedArgs,
            responseStreamer,
            idsAlreadyProcessed,
            supportLegacyId = true,
            includeNonClinicalResources = false,
            nonClinicalResourcesDepth = 1,
            proxyPatientIds = [],
            proxyPatientResources = []
        }
    ) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            /**
             * @type {BundleEntry[]}
             */
            let entries = [];

            // so any POSTed data is not read as parameters
            parsedArgs.remove('resource');

            const {
                /** @type {import('mongodb').Document}**/
                query
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                resourceType,
                useAccessIndex: this.configManager.useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                requestId: requestInfo.requestId,
                parsedArgs,
                operation: READ,
                accessRequested: (requestInfo.method.toLowerCase() === 'delete' ? 'write' : 'read')
            });

            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
             */
            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;

            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;

            /**
             * @type {QueryItem[]}
             */
            const queries = [];
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            const optionsForQueries = [];

            const databaseQueryManager = this.databaseQueryFactory.createQuery({resourceType, base_version});

            let cursor = await databaseQueryManager.findAsync({query, options});
            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

            const collectionName = cursor.getCollection();
            queries.push(
                new QueryItem({
                        query,
                        resourceType,
                        collectionName
                    }
                )
            );
            optionsForQueries.push(options);
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = explain || debug ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then just return one result
                cursor = cursor.limit(1);
            }

            /**
             * @type {BundleEntry[]}
             */
            const topLevelBundleEntries = [];

            while (await cursor.hasNext()) {
                /**
                 * element
                 * @type {Resource|null}
                 */
                let startResource = await cursor.next();
                if (startResource) {
                    /**
                     * @type {BundleEntry}
                     */

                    startResource = await this.databaseAttachmentManager.transformAttachments(
                        startResource, RETRIEVE
                    );
                    const current_entity = {
                        id: startResource.id,
                        resource: startResource
                    };
                    entries = entries.concat([current_entity]);
                    topLevelBundleEntries.push(current_entity);
                }
            }

            /**
             * @type {Resource[]}
             */
            const parentResources = topLevelBundleEntries.map(e => e.resource);

            /**
             * @type {{path:string, params: string,target:{type: string}[]}[]}
             */
            const linkItems = graphDefinition.link;
            /**
             * @type {{entities: ResourceEntityAndContained[], queryItems: QueryItem[]}}
             */
            let {entities: allRelatedEntries, queryItems} = await this.processGraphLinksAsync(
                {
                    requestInfo,
                    base_version,
                    parentResourceType: resourceType,
                    parentResources,
                    linkItems,
                    explain,
                    debug,
                    parsedArgs,
                    supportLegacyId,
                    proxyPatientIds,
                    proxyPatientResources
                }
            );

            for (const q of queryItems) {
                if (q) {
                    queries.push(q);
                }
                if (q.explanations) {
                    for (const e of q.explanations) {
                        explanations.push(e);
                    }
                }
            }
            // adding proxy patient resources to top level as no parent resource
            allRelatedEntries = allRelatedEntries.concat(proxyPatientResources);

            /**
             * @type {ResourceIdentifier[]}
             */
            const idsOfBundleEntriesProcessed = idsAlreadyProcessed;
            for (const /** @type {ResourceEntityAndContained} */ entity of allRelatedEntries) {
                /**
                 * @type {Resource}
                 */
                const topLevelResource = entity.resource;
                /**
                 * @type {BundleEntry[]}
                 */
                let bundleEntriesForTopLevelResource = [];

                bundleEntriesForTopLevelResource.push({
                    id: topLevelResource.id,
                    resource: topLevelResource
                });

                if (entity.containedEntries.length > 0) {
                    /**
                     * @type {BundleEntry[]}
                     */
                    const recursiveEntries = entity.containedEntries.flatMap((e) =>
                        this.getRecursiveContainedEntities(e)
                    );

                    if (contained) {
                        topLevelResource.contained = recursiveEntries.map(e => e.resource);
                    } else {
                        bundleEntriesForTopLevelResource = bundleEntriesForTopLevelResource.concat(recursiveEntries);
                    }
                }
                bundleEntriesForTopLevelResource = await this.enrichmentManager.enrichBundleEntriesAsync(
                    {
                        entries: bundleEntriesForTopLevelResource,
                        parsedArgs
                    }
                );
                // /**
                //  * @type {string[]}
                //  */
                // const accessCodes = this.scopesManager.getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope);
                // bundleEntriesForTopLevelResource = bundleEntriesForTopLevelResource.filter(
                //     e => this.scopesManager.doesResourceHaveAnyAccessCodeFromThisList(
                //         accessCodes, requestInfo.user, requestInfo.scope, e.resource
                //     )
                // );

                if (parsedArgs.resourceFilterList) {
                    // filter resources that were used for link to requested resources
                    let resourceFilterList = parsedArgs.resourceFilterList;
                    bundleEntriesForTopLevelResource = bundleEntriesForTopLevelResource.filter(
                        (entry) => resourceFilterList.includes(entry.resource.resourceType)
                    );
                    entries = entries.filter((entry) =>
                        resourceFilterList.includes(entry.resource.resourceType)
                    );
                }

                if (includeNonClinicalResources) {
                    let resourceTypesToExclude = clinicalResources;
                    let resourcesList = bundleEntriesForTopLevelResource.map((e) => e.resource);
                    if (contained) {
                        resourcesList = [resourcesList[0], ...resourcesList[0].contained];
                    }

                    for (let i = 1; i <= nonClinicalResourcesDepth; i++) {
                        // finding non clinical resources in depth using previous result as input
                        let {entities, queryItems} = await this.getLinkedNonClinicalResources(
                            requestInfo,
                            resourcesList,
                            resourceTypesToExclude,
                            parsedArgs,
                            base_version,
                            explain,
                            debug
                        );

                        if (contained) {
                            bundleEntriesForTopLevelResource[0].resource.contained =
                                bundleEntriesForTopLevelResource[0].resource.contained.concat(
                                    entities.flatMap((c) => c.resource)
                                );
                        } else {
                            bundleEntriesForTopLevelResource =
                                bundleEntriesForTopLevelResource.concat(entities);
                        }

                        // will be used for next depth
                        resourcesList = entities.map((e) => e.resource);

                        for (const q of queryItems) {
                            if (q) {
                                queries.push(q);
                            }
                            if (q.explanations) {
                                for (const e of q.explanations) {
                                    explanations.push(e);
                                }
                            }
                        }

                        // in case of explain, currently we are fetching one document of each resource type
                        if (explain) {
                            let resourceTypes = resourcesList.map((e) => e.resourceType);
                            resourceTypesToExclude = resourceTypesToExclude.concat(resourceTypes);
                        }
                    }
                }

                if (responseStreamer) {
                    for (const bundleEntry1 of bundleEntriesForTopLevelResource) {
                        const resourceIdentifier = new ResourceIdentifier(bundleEntry1.resource);

                        if (!idsOfBundleEntriesProcessed.some(i => i.equals(resourceIdentifier))) {
                            await responseStreamer.writeBundleEntryAsync(
                                {
                                    bundleEntry: bundleEntry1
                                }
                            );
                            idsOfBundleEntriesProcessed.push(resourceIdentifier);
                        }
                    }
                } else {
                    for (const bundleEntry1 of bundleEntriesForTopLevelResource) {
                        const resourceIdentifier = new ResourceIdentifier(bundleEntry1.resource);

                        if (!idsOfBundleEntriesProcessed.some(i => i.equals(resourceIdentifier))) {
                            entries.push(bundleEntry1);
                            idsOfBundleEntriesProcessed.push(resourceIdentifier);
                        }
                    }
                }
            }

            /**
             * @type {ResourceIdentifier[]}
             */
            const bundleEntryIdsProcessed = entries.map(e => new ResourceIdentifier(e.resource));
            if (responseStreamer) {
                entries = [];
            } else {
                entries = this.bundleManager.removeDuplicateEntries({entries});
            }

            return new ProcessMultipleIdsAsyncResult(
                {
                    entries,
                    queryItems: queries,
                    options: optionsForQueries,
                    explanations,
                    bundleEntryIdsProcessed
                }
            );
        } catch (e) {
            logError(`Error in processMultipleIdsAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in processMultipleIdsAsync(): ' + `resourceType: ${resourceType} , `,
                error: e,
                args: {
                    base_version,
                    requestInfo,
                    resourceType,
                    graphDefinition,
                    contained,
                    explain,
                    debug,
                    parsedArgs
                }
            });
        }
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Object} graphDefinitionJson (a GraphDefinition resource)
     * @param {boolean} contained
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @return {Promise<Bundle>}
     */
    async processGraphAsync(
        {
            requestInfo,
            base_version,
            resourceType,
            graphDefinitionJson,
            contained,
            responseStreamer,
            parsedArgs,
            supportLegacyId = true,
            includeNonClinicalResources = false,
            nonClinicalResourcesDepth = 1
        }
    ) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * @type {Resource}
             */
            const graphDefinition = FhirResourceCreator.create(graphDefinitionJson, GraphDefinition);
            assertTypeEquals(graphDefinition, GraphDefinition);

            // see if the count of ids is greater than batch size
            /**
             * @type {ParsedArgsItem}
             */
            const idParsedArg = parsedArgs.get('id') || parsedArgs.get('_id');
            /**
             * @type {string[]|null}
             */
            const ids = idParsedArg.queryParameterValue.values;
            /**
             * @type {string[][]}
             */
            const idChunks = ids ? sliceIntoChunks(ids, this.configManager.graphBatchSize) : [];

            /**
             * @type {BundleEntry[]}
             */
            let entries = [];
            /**
             * @type {QueryItem[]}
             */
            let queryItems = [];
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            let options = [];
            /**
             * @type {import('mongodb').Document[]}
             */
            let explanations = [];

            /**
             * @type {ResourceIdentifier[]}
             */
            let bundleEntryIdsProcessed = [];

            for (const /** @type {string[]} */ idChunk of idChunks) {
                const parsedArgsForChunk = parsedArgs.clone();
                parsedArgsForChunk.id = idChunk;
                parsedArgsForChunk.resourceFilterList = parsedArgs.resourceFilterList;
                /**
                 * @type {string[]}
                 */
                let proxyPatientIds = [];
                /**
                 * @type {ResourceEntityAndContained[]}
                 */
                let proxyPatientResources = [];
                if (resourceType === 'Person') {
                    proxyPatientIds = idChunk.map((id) => {
                        return PERSON_PROXY_PREFIX + id;
                    });
                } else if (resourceType === 'Patient') {
                    proxyPatientIds = idChunk.filter((q) => q && q.startsWith(PERSON_PROXY_PREFIX));
                }

                /**
                 * @type {ProcessMultipleIdsAsyncResult}
                 */
                const {
                    entries: entries1,
                    queryItems: queryItems1,
                    options: options1,
                    explanations: explanations1,
                    bundleEntryIdsProcessed: bundleEntryIdsProcessed1
                } = await this.processMultipleIdsAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType,
                        graphDefinition,
                        contained,
                        explain: !!parsedArgs._explain,
                        debug: !!parsedArgs._debug,
                        parsedArgs: parsedArgsForChunk,
                        responseStreamer,
                        idsAlreadyProcessed: bundleEntryIdsProcessed,
                        supportLegacyId,
                        includeNonClinicalResources,
                        nonClinicalResourcesDepth,
                        proxyPatientIds,
                        proxyPatientResources
                    }
                );
                entries = entries.concat(entries1);
                queryItems = queryItems.concat(queryItems1);
                options = options.concat(options1);
                explanations = explanations.concat(explanations1);
                bundleEntryIdsProcessed = bundleEntryIdsProcessed.concat(bundleEntryIdsProcessed1);
            }
            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {Resource[]}
             */
            const resources = entries.map(bundleEntry => bundleEntry.resource);

            /**
             * @type {Bundle}
             */
            const bundle = this.bundleManager.createRawBundle(
                {
                    type: 'searchset',
                    requestId: requestInfo.userRequestId,
                    originalUrl: requestInfo.originalUrl,
                    host: requestInfo.host,
                    protocol: requestInfo.protocol,
                    resources,
                    base_version,
                    parsedArgs,
                    originalQuery: queryItems,
                    originalOptions: options,
                    columns: new Set(),
                    stopTime,
                    startTime,
                    user: requestInfo.user,
                    explanations
                }
            );
            if (responseStreamer) {
                responseStreamer.setBundle({bundle});
            }
            return bundle;
        } catch (e) {
            logError(`Error in processGraphAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in processGraphAsync(): ' + `resourceType: ${resourceType} , ` + e.message,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    resourceType,
                    graphDefinitionJson,
                    contained,
                    parsedArgs,
                    responseStreamer
                }
            });
        }
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Object} graphDefinitionJson (a GraphDefinition resource)
     * @param {BaseResponseStreamer} responseStreamer
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @return {Promise<Bundle>}
     */
    async deleteGraphAsync(
        {
            requestInfo,
            base_version,
            resourceType,
            graphDefinitionJson,
            responseStreamer,
            parsedArgs,
            supportLegacyId = true
        }
    ) {
        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * Raw Bundle
             * @type {Bundle}
             */
            const bundle = await this.processGraphAsync(
                {
                    requestInfo,
                    base_version,
                    resourceType,
                    contained: false,
                    graphDefinitionJson,
                    responseStreamer: null, // don't let graph send the response
                    parsedArgs,
                    supportLegacyId
                }
            );
            // now iterate and delete by resuourceType and Id
            /**
             * @type {BundleEntry[]}
             */
            const deleteOperationBundleEntries = [];
            for (const entry of (bundle.entry || [])) {
                /**
                 * Raw Resource
                 * @type {Resource}
                 */
                const resource = entry.resource;
                /**
                 * @type {string}
                 */
                const resultResourceType = resource.resourceType;

                await this.scopesValidator.verifyHasValidScopesAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: resultResourceType,
                    action: 'graph',
                    accessRequested: 'write',
                    startTime
                });

                await this.removeHelper.deleteManyAsync({
                    requestInfo,
                    resources: [resource],
                    base_version,
                    resourceType: resultResourceType
                });

                // for testing with delay
                // await new Promise(r => setTimeout(r, 10000));

                // noinspection JSAnnotator
                const bundleEntry = new BundleEntry({
                    id: resource.id,
                    resource: FhirResourceCreator.create({
                        id: resource.id,
                        _uuid: resource._uuid,
                        resourceType: resultResourceType
                    }, ResourceContainer),
                    request: new BundleRequest(
                        {
                            id: requestInfo.userRequestId,
                            method: 'DELETE',
                            url: `/${base_version}/${resultResourceType}/${resource.id}`
                        }
                    )
                });
                deleteOperationBundleEntries.push(bundleEntry);
                if (responseStreamer) {
                    await responseStreamer.writeBundleEntryAsync({bundleEntry});
                }
            }
            const deleteOperationBundle = new Bundle({
                id: requestInfo.userRequestId,
                type: 'batch-response',
                entry: deleteOperationBundleEntries,
                total: deleteOperationBundleEntries.length
            });
            if (responseStreamer) {
                responseStreamer.setBundle({bundle: deleteOperationBundle});
            }
            return deleteOperationBundle;
        } catch (e) {
            logError(`Error in deleteGraphAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in deleteGraphAsync(): ' + `resourceType: ${resourceType} , ` + e.message,
                error: e,
                args: {
                    requestInfo,
                    base_version,
                    resourceType,
                    graphDefinitionJson,
                    parsedArgs,
                    responseStreamer
                }
            });
        }
    }
}

module.exports = {
    GraphHelper
};
