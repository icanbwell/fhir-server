const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { ConfigManager } = require('../../utils/configManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../../utils/httpErrors');
const { PERSON_PROXY_PREFIX } = require('../../constants');
const { sliceIntoChunks } = require('../../utils/list.util');

class AccessHistoryOperation {
    /**
     * @param {Object} params
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {PersonToPatientIdsExpander} params.personToPatientIdsExpander
     * @param {PatientFilterManager} params.patientFilterManager
     * @param {AccessHistoryClickHouseRepository} params.accessHistoryClickHouseRepository
     * @param {ConfigManager} params.configManager
     * @param {ScopesValidator} params.scopesValidator
     */
    constructor({
        databaseQueryFactory,
        personToPatientIdsExpander,
        patientFilterManager,
        accessHistoryClickHouseRepository,
        configManager,
        scopesValidator
    }) {
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        this.accessHistoryClickHouseRepository = accessHistoryClickHouseRepository;

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
    }

    /**
     * @param {Object} params
     * @param {import('../common/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {import('../query/parsedArgs').ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @returns {Promise<Object>}
     */
    async accessHistoryAsync({ requestInfo, parsedArgs, resourceType }) {
        const id = parsedArgs.id;
        const base_version = parsedArgs.base_version;
        assertIsValid(id, 'id is required for $access-history');

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime: Date.now(),
            action: '$access-history',
            accessRequested: 'read'
        });

        if (!this.accessHistoryClickHouseRepository) {
            throw new BadRequestError(
                '$access-history operation requires ClickHouse to be enabled'
            );
        }

        // 1. Get linked Patient UUIDs (resolves sourceId to UUID internally)
        const patientUuids = await this.personToPatientIdsExpander.getPatientProxyIdsAsync({
            base_version,
            ids: [id],
            includePatientPrefix: false
        });

        // Extract the resolved Person UUID from the proxy patient entry
        const proxyEntry = patientUuids.find(p => p.startsWith(PERSON_PROXY_PREFIX));
        const resolvedPersonUuid = proxyEntry ? proxyEntry.replace(PERSON_PROXY_PREFIX, '') : null;

        if (!resolvedPersonUuid) {
            throw new NotFoundError(`Person with id ${id} not found`);
        }

        if (requestInfo.isUser &&
            resolvedPersonUuid !== requestInfo.personIdFromJwtToken &&
            resolvedPersonUuid !== requestInfo.masterPersonIdFromJwtToken) {
            throw new ForbiddenError(
                'Access denied: you can only view access history for your own Person resource'
            );
        }

        if (!patientUuids || patientUuids.length === 0) {
            return { resourceType: 'Parameters', parameter: [] };
        }

        // 2. Collect entity_refs from MongoDB
        const entityRefs = await this._collectEntityRefs({
            patientUuids,
            base_version
        });

        if (entityRefs.length === 0) {
            return { resourceType: 'Parameters', parameter: [] };
        }

        // 3. Query ClickHouse (in batches)
        const batchSize = this.configManager.accessHistoryBatchSize;
        const allRows = [];
        for (let i = 0; i < entityRefs.length; i += batchSize) {
            const batch = entityRefs.slice(i, i + batchSize);
            const { rows } = await this.accessHistoryClickHouseRepository.getAccessHistoryAsync({
                entityRefs: batch
            });
            if (rows && rows.length > 0) {
                allRows.push(...rows);
            }
        }

        if (allRows.length === 0) {
            return { resourceType: 'Parameters', parameter: [] };
        }

        // 4. Group by accessor (preserving per-resource-type counts)
        const accessorMap = this._groupByAccessor(allRows);

        // 5. Resolve accessor display names
        const accessorRefs = Object.keys(accessorMap);
        const accessorDetails = await this._resolveAccessorDetails({
            accessorRefs,
            base_version
        });

        // 6. Build FHIR Parameters response
        return this._buildParametersResponse({ accessorMap, accessorDetails });
    }

    /**
     * @param {Object} params
     * @param {string[]} params.patientUuids
     * @param {string} params.base_version
     * @returns {Promise<string[]>}
     */
    async _collectEntityRefs({ patientUuids, base_version }) {
        const entityRefs = [];

        for (const uuid of patientUuids) {
            entityRefs.push(`Patient/${uuid}`);
        }

        const patientRefs = patientUuids.map((uuid) => `Patient/${uuid}`);
        const resourceTypes = this.patientFilterManager.getAllPatientOrPersonRelatedResources()
            .filter(rt => rt !== 'Patient' && rt !== 'AuditEvent');

        const parallelLimit = this.configManager.accessHistoryMaxParallelProcess;
        const chunks = sliceIntoChunks(resourceTypes, parallelLimit);

        for (const chunk of chunks) {
            const chunkResults = await Promise.all(
                chunk.map(rt => this._getEntityRefsForResourceType({ rt, patientRefs, base_version }))
            );
            for (const refs of chunkResults) {
                entityRefs.push(...refs);
            }
        }

        return entityRefs;
    }

    async _getEntityRefsForResourceType({ rt, patientRefs, base_version }) {
        const linkingField = this.patientFilterManager.getPatientPropertyForResource({
            resourceType: rt
        });
        if (!linkingField) {
            return [];
        }

        const uuidField = linkingField.replace('.reference', '._uuid');
        const dqm = this.databaseQueryFactory.createQuery({
            resourceType: rt,
            base_version
        });

        const cursor = await dqm.findAsync({
            query: { [uuidField]: { $in: patientRefs } },
            options: { projection: { _uuid: 1 } }
        });

        const refs = [];
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            if (doc && doc._uuid) {
                refs.push(`${rt}/${doc._uuid}`);
            }
        }
        return refs;
    }

    /**
     * Groups ClickHouse rows by accessor_uuid, preserving per-resource-type breakdowns.
     * @param {Object[]} rows
     * @returns {Object<string, {totalCount: number, lastAccessed: string, purposes: Set<string>, resourceTypes: Object<string, number>}>}
     */
    _groupByAccessor(rows) {
        const map = {};
        for (const row of rows) {
            const key = row.accessor_uuid;
            if (!map[key]) {
                map[key] = {
                    totalCount: 0,
                    lastAccessed: row.last_accessed,
                    purposes: new Set(),
                    resourceTypes: {}
                };
            }
            const count = Number(row.access_count);
            map[key].totalCount += count;
            if (row.last_accessed > map[key].lastAccessed) {
                map[key].lastAccessed = row.last_accessed;
            }
            if (Array.isArray(row.purposes)) {
                for (const p of row.purposes) {
                    if (p && p !== '') {
                        map[key].purposes.add(p);
                    }
                }
            }
            const rt = row.entity_resource_type;
            map[key].resourceTypes[rt] = (map[key].resourceTypes[rt] || 0) + count;
        }
        return map;
    }

    /**
     * Resolves accessor references to display names and organizations.
     * For proxy patient accessors (Patient/person.{id}), resolves display and
     * organization from Person's managingOrganization.
     * @param {Object} params
     * @param {string[]} params.accessorRefs
     * @param {string} params.base_version
     * @returns {Promise<Object<string, {display: string, organizations: Array<{reference: string, display: string}>}>>}
     */
    async _resolveAccessorDetails({ accessorRefs, base_version }) {
        const details = {};
        const proxyPersonIds = [];
        const byType = {};

        for (const ref of accessorRefs) {
            const slashIdx = ref.indexOf('/');
            if (slashIdx === -1) {
                continue;
            }
            const type = ref.substring(0, slashIdx);
            const refId = ref.substring(slashIdx + 1);

            if (type === 'Patient' && refId.startsWith(PERSON_PROXY_PREFIX)) {
                proxyPersonIds.push(refId.replace(PERSON_PROXY_PREFIX, ''));
            } else {
                if (!byType[type]) {
                    byType[type] = [];
                }
                byType[type].push(refId);
            }
        }

        // Resolve standard accessors (Practitioner, etc.)
        for (const [type, ids] of Object.entries(byType)) {
            const resources = await this._findResourcesByUuids({
                resourceType: type,
                uuids: ids,
                base_version,
                projection: { _uuid: 1, name: 1 }
            });
            for (const resource of resources) {
                details[`${type}/${resource._uuid}`] = {
                    display: this._extractDisplayName(resource),
                    organizations: []
                };
            }
        }

        // Resolve proxy patient accessors (Patient/person.{personId})
        if (proxyPersonIds.length > 0) {
            const persons = await this._findResourcesByUuids({
                resourceType: 'Person',
                uuids: proxyPersonIds,
                base_version,
                projection: { _uuid: 1, name: 1, 'managingOrganization._uuid': 1, 'managingOrganization.reference': 1 }
            });

            const personData = {};
            const orgIds = new Set();
            for (const person of persons) {
                let orgId = null;
                if (person.managingOrganization) {
                    const rawRef = person.managingOrganization._uuid ||
                        person.managingOrganization.reference;
                    if (rawRef) {
                        orgId = rawRef.replace('Organization/', '');
                        orgIds.add(orgId);
                    }
                }
                personData[person._uuid] = {
                    display: this._extractDisplayName(person),
                    orgId
                };
            }

            const orgDetails = {};
            if (orgIds.size > 0) {
                const orgs = await this._findResourcesByUuids({
                    resourceType: 'Organization',
                    uuids: Array.from(orgIds),
                    base_version,
                    projection: { _uuid: 1, name: 1 }
                });
                for (const org of orgs) {
                    orgDetails[org._uuid] = {
                        reference: `Organization/${org._uuid}`,
                        display: typeof org.name === 'string' ? org.name : ''
                    };
                }
            }

            for (const personId of proxyPersonIds) {
                const accessorRef = `Patient/${PERSON_PROXY_PREFIX}${personId}`;
                const data = personData[personId];
                const organizations = [];
                if (data && data.orgId && orgDetails[data.orgId]) {
                    organizations.push(orgDetails[data.orgId]);
                }
                details[accessorRef] = {
                    display: (data && data.display) || accessorRef,
                    organizations
                };
            }
        }
        return details;
    }

    /**
     * Queries resources by UUIDs with a given projection.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string[]} params.uuids
     * @param {string} params.base_version
     * @param {Object} params.projection
     * @returns {Promise<Object[]>}
     */
    async _findResourcesByUuids({ resourceType, uuids, base_version, projection }) {
        if (!uuids || uuids.length === 0) {
            return [];
        }

        const dqm = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version
        });
        const cursor = await dqm.findAsync({
            query: { _uuid: { $in: uuids } },
            options: { projection }
        });

        const results = [];
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            if (doc) {
                results.push(doc);
            }
        }
        return results;
    }

    /**
     * Extracts a display name from a resource.
     * @param {Object} resource
     * @returns {string}
     */
    _extractDisplayName(resource) {
        if (!resource.name) {
            return '';
        }

        if (typeof resource.name === 'string') {
            return resource.name;
        }

        if (!Array.isArray(resource.name)) {
            return '';
        }

        const humanName = resource.name[0];
        if (!humanName) {
            return '';
        }

        const parts = [];
        if (humanName.prefix) {
            parts.push(
                Array.isArray(humanName.prefix) ? humanName.prefix[0] : humanName.prefix
            );
        }
        if (humanName.given) {
            parts.push(
                Array.isArray(humanName.given) ? humanName.given.join(' ') : humanName.given
            );
        }
        if (humanName.family) {
            parts.push(humanName.family);
        }
        if (parts.length > 0) {
            return parts.join(' ');
        }

        return humanName.text || '';
    }

    /**
     * Builds the FHIR Parameters response per the FDR spec.
     * @param {Object} params
     * @param {Object} params.accessorMap
     * @param {Object} params.accessorDetails
     * @returns {Object}
     */
    _buildParametersResponse({ accessorMap, accessorDetails }) {
        const parameter = [];

        for (const [accessorRef, data] of Object.entries(accessorMap)) {
            const detail = accessorDetails[accessorRef] || { display: accessorRef, organizations: [] };

            const parts = [
                {
                    name: 'reference',
                    valueReference: {
                        reference: accessorRef,
                        display: detail.display || accessorRef
                    }
                },
                {
                    name: 'totalCount',
                    valueInteger: data.totalCount
                },
                {
                    name: 'lastAccessed',
                    valueDateTime: data.lastAccessed
                }
            ];

            // Organization parts (for proxy patient accessors)
            if (detail.organizations) {
                for (const org of detail.organizations) {
                    parts.push({
                        name: 'organization',
                        valueReference: {
                            reference: org.reference,
                            display: org.display
                        }
                    });
                }
            }

            // Purpose of event entries
            for (const purposeStr of data.purposes) {
                const separatorIdx = purposeStr.lastIndexOf('|');
                if (separatorIdx !== -1) {
                    parts.push({
                        name: 'purposeOfEvent',
                        valueCoding: {
                            system: purposeStr.substring(0, separatorIdx),
                            code: purposeStr.substring(separatorIdx + 1)
                        }
                    });
                } else {
                    parts.push({
                        name: 'purposeOfEvent',
                        valueCoding: { code: purposeStr }
                    });
                }
            }

            // Resource type breakdown
            for (const [rt, count] of Object.entries(data.resourceTypes)) {
                parts.push({
                    name: 'resourceType',
                    part: [
                        { name: 'type', valueCode: rt },
                        { name: 'count', valueInteger: count }
                    ]
                });
            }

            parameter.push({
                name: 'accessor',
                part: parts
            });
        }

        return {
            resourceType: 'Parameters',
            parameter
        };
    }
}

module.exports = { AccessHistoryOperation };
