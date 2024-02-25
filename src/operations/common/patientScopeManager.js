const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { ScopesManager } = require('../security/scopesManager');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { NestedPropertyReader } = require('../../utils/nestedPropertyReader');
const { ForbiddenError } = require('../../utils/httpErrors');
const { isUuid } = require('../../utils/uid.util');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');

class PatientScopeManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PersonToPatientIdsExpander} personToPatientIdsExpander
     * @param {ScopesManager} scopesManager
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor (
        {
            databaseQueryFactory,
            personToPatientIdsExpander,
            scopesManager,
            patientFilterManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
    }

    /**
     * Gets linked patients
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string} personIdFromJwtToken
     * @return {Promise<string[]>}
     */
    async getLinkedPatientsAsync (
        {
            base_version, isUser, personIdFromJwtToken
        }
    ) {
        try {
            if (isUser && personIdFromJwtToken) {
                return await this.getPatientIdsByPersonIdAsync(
                    {
                        base_version, personIdFromJwtToken
                    });
            }
            return [];
        } catch (e) {
            throw new RethrownError({
                message: `Error get linked patients for person id: ${personIdFromJwtToken}`,
                error: e
            });
        }
    }

    /**
     * Gets Patient id from identifiers
     * @param {string} base_version
     * @param {string} personIdFromJwtToken
     * @return {Promise<string[]>}
     */
    async getPatientIdsByPersonIdAsync (
        {
            base_version,
            personIdFromJwtToken
        }
    ) {
        assertIsValid(base_version);
        assertIsValid(personIdFromJwtToken);
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version
            });
            return await this.personToPatientIdsExpander.getPatientIdsFromPersonAsync({
                databaseQueryManager,
                personIds: [personIdFromJwtToken],
                totalProcessedPersonIds: new Set(),
                level: 1
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error getting patient id for person id: ${personIdFromJwtToken}`,
                error: e
            });
        }
    }

    /**
     *
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string} personIdFromJwtToken
     * @param {string[] | null} patientIdsFromJwtToken
     * @returns {Promise<string[]|null>}
     */
    async getPatientIdsFromScopeAsync ({ base_version, isUser, personIdFromJwtToken, patientIdsFromJwtToken }) {
        /**
         * @type {string[]}
         */
        const patientIdsLinkedToPersonId = personIdFromJwtToken
            ? await this.getLinkedPatientsAsync(
                {
                    base_version, isUser, personIdFromJwtToken
                })
            : [];
        /**
         * @type {string[]|null}
         */
        const allPatientIdsFromJwtToken = patientIdsFromJwtToken
            ? patientIdsFromJwtToken.concat(patientIdsLinkedToPersonId)
            : patientIdsLinkedToPersonId;

        return allPatientIdsFromJwtToken;
    }

    /**
     * Gets value of patient property from resource
     * @param {Resource} resource
     * @return {string | undefined}
     */
    getValueOfPatientPropertyFromResource ({ resource }) {
        assertTypeEquals(resource, Resource);
        /** @type {string} */
        const resourceType = resource.resourceType;
        // Get name of patient property for this resource type
        /**
         * @type {string|string[]|null}
         */
        const patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
            resourceType
        });
        // If this resource has a patient property then get the value of that property
        if (patientFilterProperty) {
            if (Array.isArray(patientFilterProperty)) {
                for (const p of patientFilterProperty) {
                    // if patient itself then search by _uuid
                    if (p === 'id') {
                        return resource._uuid;
                    } else {
                        const propertyUuid = p.replace('.reference', '._uuid');
                        const value = NestedPropertyReader.getNestedProperty({ obj: resource, path: propertyUuid });
                        if (value !== undefined) {
                            return value.replace('Patient/', '');
                        }
                    }
                }
            } else {
                if (patientFilterProperty === 'id') {
                    return resource._uuid;
                } else {
                    const propertyUuid = patientFilterProperty.replace('.reference', '._uuid');
                    const value = NestedPropertyReader.getNestedProperty({ obj: resource, path: propertyUuid });
                    if (value !== undefined) {
                        return value.replace('Patient/', '');
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Gets whether the user can write the given resource with the given patient scope
     * @param {string[] | null} patientIds
     * @param {Resource} resource
     * @return {boolean}
     */
    canWriteResourceWithPatientScope ({ patientIds, resource }) {
        assertTypeEquals(resource, Resource);

        /** @type {string} */
        const resourceType = resource.resourceType;

        // if this resource is not allowed to be written with a patient scope then return an error
        if (!this.patientFilterManager.canAccessResourceWithPatientScope({ resourceType })) {
            throw new ForbiddenError(`Resource type ${resourceType} cannot be written via a patient scope`);
        }
        // separate uuids from non-uuids
        const patientUuids = patientIds.filter(id => isUuid(id));

        /** @type {string} */
        const patientForResource = this.getValueOfPatientPropertyFromResource({ resource });
        // if we have any uuids then check if any of those are included in patient ids in patient scope
        if (patientUuids && patientUuids.length > 0) {
            if (patientUuids.includes(patientForResource)) {
                return true;
            }
        }
        // now check any non-uuids
        const patientNonUuids = patientIds.filter(id => !isUuid(id));
        if (patientNonUuids && patientNonUuids.length > 0) {
            if (patientNonUuids.includes(patientForResource)) {
                return true;
            }
        }
        return false;
    }
}

module.exports = {
    PatientScopeManager
};
