const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { ScopesManager } = require('../security/scopesManager');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { NestedPropertyReader } = require('../../utils/nestedPropertyReader');
const { ForbiddenError } = require('../../utils/httpErrors');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { PERSON_PROXY_PREFIX, HTTP_CONTEXT_KEYS } = require('../../constants');
const { ReferenceParser } = require('../../utils/referenceParser');
const httpContext = require('express-http-context');

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
     * @param {boolean} addPersonOwnerToContext
     * @return {Promise<string[]>}
     */
    async getLinkedPatientsAsync (
        {
            base_version, isUser, personIdFromJwtToken, addPersonOwnerToContext = false
        }
    ) {
        try {
            if (isUser && personIdFromJwtToken) {
                // return patient ids from request context if already found once
                let linkedPatientIdsFromHttpContext = httpContext.get(
                    `${HTTP_CONTEXT_KEYS.LINKED_PATIENTS_FOR_PERSON_PREFIX}${personIdFromJwtToken}`
                );
                if (linkedPatientIdsFromHttpContext) {
                    return linkedPatientIdsFromHttpContext;
                }

                let linkedPatientIds = await this.getPatientIdsByPersonIdAsync({
                    base_version,
                    personIdFromJwtToken,
                    addPersonOwnerToContext
                });
                httpContext.set(
                    `${HTTP_CONTEXT_KEYS.LINKED_PATIENTS_FOR_PERSON_PREFIX}${personIdFromJwtToken}`,
                    linkedPatientIds
                );
                return linkedPatientIds;
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
     * @param {boolean} addPersonOwnerToContext
     * @return {Promise<string[]>}
     */
    async getPatientIdsByPersonIdAsync (
        {
            base_version,
            personIdFromJwtToken,
            addPersonOwnerToContext = false
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
                level: 1,
                addPersonOwnerToContext
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
     * @param {boolean} addPersonOwnerToContext
     * @returns {Promise<string[]|null>}
     */
    async getPatientIdsFromScopeAsync ({ base_version, isUser, personIdFromJwtToken, addPersonOwnerToContext = false }) {
        /**
         * @type {string[]}
         */
        let patientIdsLinkedToPersonId;
        if (personIdFromJwtToken) {
            // Include Proxy Person too
            patientIdsLinkedToPersonId = [`${PERSON_PROXY_PREFIX}${personIdFromJwtToken}`];
            patientIdsLinkedToPersonId = patientIdsLinkedToPersonId.concat(
                await this.getLinkedPatientsAsync(
                    {
                        base_version, isUser, personIdFromJwtToken, addPersonOwnerToContext
                    }
                )
            );
        } else {
            patientIdsLinkedToPersonId = []
        }

        return patientIdsLinkedToPersonId;
    }

    /**
     * Gets value of patient property from resource
     * @param {Resource} resource
     * @param {string|null} property
     * @return {string[] | undefined}
     */
    getValueOfPropertyFromResource ({ resource, property }) {
        assertTypeEquals(resource, Resource);
        // If this resource has a patient property then get the value of that property
        if (property) {
            if (property === 'id') {
                return [resource._uuid];
            } else {
                const propertyUuid = property.replace('.reference', '._uuid');
                let value = NestedPropertyReader.getNestedProperty({ obj: resource, path: propertyUuid });
                // for incoming request, it may be stored in ".reference" only
                if (!value || value?.length === 0) {
                    value = NestedPropertyReader.getNestedProperty({ obj: resource, path: property });
                }
                // If patient reference field returns multiple ids, return all of them
                if (Array.isArray(value) && value.length > 0) {
                    const result = [];
                    for (let item of value) {
                        const { id, sourceAssigningAuthority, resourceType } = ReferenceParser.parseReference(item);
                        if (resourceType === 'Patient') {
                            result.push(
                                sourceAssigningAuthority && !isUuid(id)
                                ? generateUUIDv5(`${id}|${sourceAssigningAuthority}`)
                                : id
                            );
                        }
                    }
                    return result;
                }
                else if (value) {
                    const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(value);
                    return [sourceAssigningAuthority && !isUuid(id)
                        ? generateUUIDv5(`${id}|${sourceAssigningAuthority}`)
                        : id];
                }
            }
        }
        return undefined;
    }

    /**
     * Gets whether the user can write the given resource with the given patient scope
     * @param {string[] | null} patientIds
     * @param {Resource} resource
     * @return {Promise<boolean>}
     */
    async canWriteResourceWithAllowedPatientIdsAsync ({ patientIds, resource }) {
        assertTypeEquals(resource, Resource);
        // confirm the resource has been run through preSave
        assertIsValid(resource._uuid, 'resource._uuid is required.  Be sure to run preSave on the resource before calling this method.');

        /** @type {string} */
        const resourceType = resource.resourceType;

        // if this resource is not allowed to be written with a patient scope then return an error
        if (!this.patientFilterManager.canAccessResourceWithPatientScope({ resourceType })) {
            throw new ForbiddenError(`Resource type ${resourceType} cannot be written via a patient scope`);
        }
        // separate uuids from non-uuids
        const patientUuids = patientIds.filter(id => isUuid(id));

        /**
         * @type {string|null}
         */
        let patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
            resourceType
        });

        if (!patientFilterProperty){
            patientFilterProperty = this.patientFilterManager.getPatientPropertyForPersonScopedResource({
                resourceType
            });
        }

        /** @type {string[]|undefined} */
        const patientForResource = this.getValueOfPropertyFromResource({ resource, property: patientFilterProperty });
        // if patient reference is not present in the resource then cannot write with patient scopes
        if (!patientForResource) {
            return false;
        }
        // if we have any uuids then check if any of those are included in patient ids in patient scope
        if (patientUuids && patientUuids.length > 0) {
            for (let patient of patientForResource) {
                if (patientUuids.includes(patient)) {
                    return true;
                }
            }
        }
        // now check any non-uuids
        const patientNonUuids = patientIds.filter(id => !isUuid(id));
        if (patientNonUuids && patientNonUuids.length > 0) {
            for (let patient of patientForResource) {
                if (patientNonUuids.includes(patient)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * returns whether this resource can be written based on permissions in the patient scope
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string|null} personIdFromJwtToken
     * @param {Resource} resource
     * @param {string | null} scope
     * @returns {Promise<boolean>}
     */
    async canWriteResourceAsync ({
        base_version,
        isUser,
        personIdFromJwtToken,
        resource,
        scope
    }) {
        assertIsValid(scope, 'scope is required');
        assertIsValid(resource, 'resource is required');
        if (!this.scopesManager.isAccessAllowedByPatientScopes({
            scope,
            resourceType: resource.resourceType
        })) {
            return true;
        }

        let personProperty = this.patientFilterManager.getPersonPropertyForResource({resourceType: resource.resourceType});
        // if access to resource is via person
        if (personProperty){
            const personsForResource = this.getValueOfPropertyFromResource({ resource, property: personProperty });
            if (!personsForResource.includes(personIdFromJwtToken)){
                return false;
            }
        }

        // Validating if resource is related to the patient
        const patientIds = await this.getPatientIdsFromScopeAsync({
            base_version,
            isUser,
            personIdFromJwtToken
        });
        if (patientIds && patientIds.length > 0) {
            return await this.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds, resource
            });
        }
        return false;
    }
}

module.exports = {
    PatientScopeManager
};
