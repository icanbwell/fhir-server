/* eslint-disable security/detect-object-injection */

const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { PatientFilterManager } = require('../fhir/patientFilterManager');
const { logInfo } = require('../operations/common/logging');
const { assertTypeEquals } = require('./assertType');

/**
 * The class is used to add/remove sensitive data from a resource
 */
class SensitiveDataProcessor {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor({
        databaseQueryFactory,
        patientFilterManager
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
    }

    /**
     *
     * @param {Resource} resource
     */
    async addSensitiveDataAccessTags({
        resource
    }) {
        const resources = Array.isArray(resource) ? resource : [resource];
        // Filter out resources that have been updated/created through the proa pipeline.
        const proaInitiatedResources = this.filterProaInitiatedResources(resources);

        if (proaInitiatedResources.length === 0) {
            logInfo('No Resources have connectionType as Proa.');
            return;
        }

        // eslint-disable-next-line no-unused-vars
        const patientIds = this.getLinkedPatientRecords(proaInitiatedResources);
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
        let patientIds = new Set();
        let patientResources = new Set();
        for (let resource of resources) {
            // If resource type is Patient directly add uuid to fetch the consent resource
            if (resource.resourceType === 'Patient') {
                patientResources.push(resource._uuid);
                continue;
            }
            // Get the exact path where patient reference is present.
            let patientProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType: resource.resourceType
            });
            // The patient property returns the path on which the patient link is stored
            // Example Procedure subject.reference. now subject can be a array. So we need to iterate over each subject and check if it has a patient reference.
            this.getListOfPatientFromResource(resource, patientProperty, '', patientIds);
        }
        return new Set([...patientIds, ...patientResources]);
    }

    /**
     * @description Recursive function that iterates over the path where the patient reference is present. Example subject.reference
     * @param {Resource} obj
     * @param {String} paths
     * @param {String} currentPath
     * @param {Set} patientIds
     * @returns List of patient ids for which consent resource is to be fetched.
     */
    getListOfPatientFromResource(obj, paths, currentPath, patientIds) {
        if (Array.isArray(obj)) {
            for (let item of obj) {
                // If
                if (!paths.includes(item)) {continue;}
                this.getListOfPatientFromResource(item, paths, currentPath, patientIds);
            }
        } else if (typeof obj === 'object') {
            for (let key in obj) {
                const newPath = currentPath ? `${currentPath}.${key}` : key;
                if (paths === newPath && obj[key].startsWith('Patient/')) {
                    patientIds.add(obj[key]);
                } else {
                    // If the current path is not included in the path where patient reference is present continue
                    if (!paths.includes(newPath)) {continue;}
                    this.getListOfPatientFromResource(obj[key], paths, newPath, patientIds);
                }
            }
        }
        return patientIds;
    }
}

module.exports = {
    SensitiveDataProcessor
};
