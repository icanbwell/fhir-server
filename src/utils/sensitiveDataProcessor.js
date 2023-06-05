/* eslint-disable security/detect-object-injection */

const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
const { PatientFilterManager } = require('../fhir/patientFilterManager');
const { logInfo, logWarn } = require('../operations/common/logging');
const { assertTypeEquals } = require('./assertType');
const { deepEqual } = require('assert');

/**
 * The class is used to add/remove sensitive data from a resource
 */
class SensitiveDataProcessor {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PatientFilterManager} patientFilterManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     */
    constructor({
        databaseQueryFactory,
        patientFilterManager,
        databaseBulkInserter
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
    }

    /**
     * @description Adds/Removes access tags for proa initiated pieplines.
     * @param {String} requestId
     * @param {Resource} resource
     * @param {boolean} updateResources
     */
    async addSensitiveDataAccessTags({
        requestId,
        resource,
        updateResources = false
    }) {
        const resources = Array.isArray(resource) ? resource : [resource];
        // Filter out resources that have been updated/created through the proa pipeline.
        const proaInitiatedResources = this.filterProaInitiatedResources(resources);
        if (proaInitiatedResources.length === 0) {
            logInfo('No Resources have connectionType as Proa.');
            return;
        }
        // eslint-disable-next-line no-unused-vars
        const patientIdToResourceMap = this.getLinkedPatientRecords(proaInitiatedResources);
        const consentDocuments = await this.getConsentDocuments(Object.keys(patientIdToResourceMap));
        // requiredAccessTag create an object were for each patientId the required access tag is present
        const requiredAccessTag = this.getClientAccessTag(consentDocuments);
        this.updateAccessTags(patientIdToResourceMap, requiredAccessTag, requestId, updateResources);
    }

    /**
     * @description Filters out a list of resources that have been updated/created using proa pipeline.
     * @param {Resource} resources
     * @returns List of resources that are proa pipeline initiated
     */
    filterProaInitiatedResources(resources) {
        return resources.filter((resource) => {
            return resource.meta.security.some(security => {
                // If system is of connectionType and code is Proa,
                // the resource has been created/updated using a proa pipeline.
                return security.system === 'https://www.icanbwell.com/connectionType' && security.code === 'proa';
            });
        });
    }

    /**
     * @description For each resource find the linked patient ids.
     * @param {Resource} resources
     * @returns List of patient ids for which consent resource is to be fetched
     */
    getLinkedPatientRecords(resources) {
        let patientIdToResourceMap = {};
        resources.forEach((resource) => {
            // Get the exact path where patient reference is present.
            let patientProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType: resource.resourceType
            });
            // The patient property returns the path on which the patient link is stored
            // Example Procedure subject.reference. now subject can be a array. So we need to iterate over each subject and check if it has a patient reference.
            let patientId = this.getPatientIdFromResource(resource, patientProperty, '');

            // Id resource if of Patient type append a prefix Patient to filter out consent records.
            if (resource.resourceType === 'Patient') {
                patientId = `Patient/${patientId}`;
            }

            // Creating an array of resources that are linked to the same patient.
            // eslint-disable no-prototype-builtins
            if (Object.prototype.hasOwnProperty.call(patientIdToResourceMap, patientId)) {
                patientIdToResourceMap[patientId].push(resource);
            } else {
                patientIdToResourceMap[patientId] = [resource];
            }
        });
        return patientIdToResourceMap;
    }

    /**
     * @description Recursive function that iterates over the path where the patient reference is present. Example subject.reference
     * @param {Resource} obj
     * @param {String} paths
     * @param {String} currentPath
     * @returns {String} patient id for which consent resource is to be fetched.
     */
    getPatientIdFromResource(obj, paths, currentPath) {
        if (Array.isArray(obj)) {
            for (let item of obj) {
                // If the current path is not included in the path where patient reference is present continue
                if (!paths.includes(item)) {continue;}
                return this.getPatientIdFromResource(item, paths, currentPath);
            }
        } else if (typeof obj === 'object') {
            for (let key in obj) {
                // Append current field we are operating to the new Path.
                const newPath = currentPath ? `${currentPath}.${key}` : key;

                if (paths === newPath && (obj[key].startsWith('Patient/') || obj.resourceType === 'Patient')) {
                    if (obj[key].startsWith('person.')) {
                        logWarn('Proxy patient id found while fetching patient ids');
                        return;
                    }
                    return obj[key];
                } else {
                    // If the current path is not included in the path where patient reference is present continue
                    if (!paths.includes(newPath)) {continue;}
                    return this.getPatientIdFromResource(obj[key], paths, newPath);
                }
            }
        }
    }

    /**
     * @description Fetches all the consent resources linked to a patient.
     * @param {String[]} patientIds
     */
    async getConsentDocuments(patientIds) {
        let consentDocuments = [];
        const query = {
            $and: [
                {'patient.reference': {$in: patientIds}},
                {'provision.type': {$eq: 'permit'}},
            ]
        };

        const consentDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Consent',
            base_version: '4_0_0',
        });

        const cursor = await consentDataBaseQueryManager.findAsync({query: query});
        while (await cursor.hasNext()) {
            consentDocuments.push(await cursor.next());
        }
        return consentDocuments;
    }

    /**
     * @description Retrieve all the access tags for a patient using it linked consent.
     * @param {Resource[]} consentDocument
     * @returns {Object} Returns a key value pair for each patient and the simulaneous client that has access.
     */
    getClientAccessTag(consentDocuments) {
        // Object to store the access tag for each patient.
        // If patient 1 has provided access to walgreens a mapping for Patient/1 = [{system: access, code: walgreens}] is created
        const patientIdAndAccessTagMap = {};
        consentDocuments.forEach((doc) => {
            // Patient linked with the current patient
            const consentPatientId = doc.patient.reference;
            const clientWithAccessPermission = doc.provision.actor
                .flatMap(consentActor => consentActor.role.coding)
                .filter(coding => coding.system === 'https://www.icanbwell.com/access')
                .map(coding => coding);
            patientIdAndAccessTagMap[consentPatientId] = clientWithAccessPermission;
        });
        return patientIdAndAccessTagMap;
    }

    /**
     * @description Remove and add the new access tags for each resource.
     * @param {Object} patientIdToResourceMap
     * @param {Object} requiredAccessTag
     * @param {String} requestId
     * @param {boolean} updateDocuments
     */
    updateAccessTags(patientIdToResourceMap, requiredAccessTag, requestId, updateDocuments) {
        // For each patient id remove any previod access tags and create a new one as per consent.
        const patientIds = Object.keys(patientIdToResourceMap);
        patientIds.forEach((id) => {
            patientIdToResourceMap[id].forEach((resource) => {
                // If for the current patient id we need to create a access tag
                // requiredAccessTag[id] tells for which patient is we need to update access tags
                // first remove the current access tag.
                if (Object.keys(requiredAccessTag).includes(id)) {
                    const previousSecurityTags = resource.meta.security;
                    resource.meta.security = this.removeAccessTag(resource.meta.security);
                    // Updating the security tag.
                    resource.meta.security = [...resource.meta.security, ...requiredAccessTag[id]];
                    // If updateDocuments is true and there has been an update to security tags than only do a bulk insert
                    if (
                        updateDocuments &&
                        deepEqual(resource.meta.security.toJson(), previousSecurityTags.toJson()) === false
                    ) {
                        const filter = {_uuid: resource._uuid};
                        // Creates a queue of operations to be performed.
                        this.databaseBulkInserter.addOperationForResourceType({
                            requestId: requestId,
                            resourceType: resource.resourceType,
                            resource: resource,
                            operationType: 'replace',
                            operation: {
                                replaceOne: {
                                    filter: filter,
                                    upsert: false,
                                    replacement: resource.toJSONInternal()
                                }
                            },
                            patches: [
                                {
                                    'op': 'replace',
                                    'path': 'meta.security',
                                    'value': resource.meta.security
                                }
                            ]
                        });
                    }
                }
            });
        });
        // Asynchronously update all the security tags
        this.databaseBulkInserter.executeAsync({
            requestId: requestId,
            base_version: '4_0_0'
        });
    }

    /**
     * @description Updates the security tag and removes acess tags
     * @param {Object} security
     * @returns {Object[]} Return a list of security but removes the security that has a access tag.
     */
    removeAccessTag(security) {
        return security.filter((coding) => {
            return !coding.system.endsWith('/access');
        });
    }
}

module.exports = {
    SensitiveDataProcessor
};
