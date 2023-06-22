/* eslint-disable security/detect-object-injection */

const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { PatientFilterManager } = require('../fhir/patientFilterManager');
const { logInfo, logWarn, logDebug } = require('../operations/common/logging');
const { assertTypeEquals } = require('./assertType');
const { PATIENT_INITIATED_CONNECTION } = require('../constants');
const { BwellPersonFinder } = require('./bwellPersonFinder');
const { PersonToPatientIdsExpander } = require('./personToPatientIdsExpander');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { SecurityTagSystem } = require('./securityTagSystem');

const patientReferencePrefix = 'Patient/';

/**
 * The class is used to add/remove sensitive data from a resource
 */
class SensitiveDataProcessor {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PatientFilterManager} patientFilterManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {PersonToPatientIdsExpander} personToPatientIdsExpander
     * @param {DatabaseBulkInserter} databaseBulkInserter
     */
    constructor({
        databaseQueryFactory,
        patientFilterManager,
        bwellPersonFinder,
        personToPatientIdsExpander,
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
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
    }

    /**
     * @description Updates access tags for patient initiated connection.
     * STEPS INVOLVED:
     * 1. Filters out resource that are patient initiated connection type.
     * 2. Fetch the bwell person for the specific patients and get all client patient.
     * 3. Fetch all the related consents.
     * 4. Create a map for patient specific security tags that needs to be updated.
     * 5. Update the secutiry access tags for each resource.
     * @param {Resource} resource
     */
    async updateResourceSecurityAccessTag({
        resource,
        returnUpdatedResources = false
    }) {
        const resources = Array.isArray(resource) ? resource : [resource];
        const patientIdToResourceMap = await this.getLinkedPatientRecords(resources);
        if (Object.keys(patientIdToResourceMap).length === 0) {
            logInfo('No Resources have connectionType as mentioned in patient pipelines.', {});
            return;
        }
        // requiredSecurityAccessTag create an object were for each patientId the required access tag is present
        const requiredSecurityAccessTag = await this.getPatientSpecificSecurityAccessTag(patientIdToResourceMap);
        const updatedResources = this.updateSecurityAccessTags(patientIdToResourceMap, requiredSecurityAccessTag);
        if (returnUpdatedResources) {
            return updatedResources;
        }
    }

    /**
     * @description Check whether the resource connection type is patient initiated connection type.
     * @param {Resource} resources
     * @returns {boolean}
     */
    isPatientInitiatedConnectionResource(resource) {
        return resource.meta.security.some(security => {
            // If system is of connectionType and code is mentioned in list of patient initiated pieplines,
            // the resource has been created/updated using a patient initiated pipeline pipeline.
            return security.system === 'https://www.icanbwell.com/connectionType' && PATIENT_INITIATED_CONNECTION.includes(security.code);
        });
    }

    /**
     * @description For each resource find the linked patient id and create a map between patient and resource.
     * @param {Resource} resources
     * @returns {Object} - return a map between patient id and resource
     */
    getLinkedPatientRecords(resources) {
        let patientIdToResourceMap = {};
        resources.forEach((resource) => {
            if (this.isPatientInitiatedConnectionResource(resource)) {
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
                logInfo(`For resource ${resource.resourceType} with _uuid ${resource._uuid}: Patient id is ${patientId}`, {});

                // Creating an array of resources that are linked to the same patient.
                if (Object.prototype.hasOwnProperty.call(patientIdToResourceMap, patientId)) {
                    patientIdToResourceMap[patientId].push(resource);
                } else {
                    patientIdToResourceMap[patientId] = [resource];
                }
            }
        });
        logDebug(
            `Number of patients for which access tag is to be updated: ${Object.keys(patientIdToResourceMap).length}`,
            {'patientIdToResourceMap': patientIdToResourceMap}
        );
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
     * For a patient find it's bwell master person and return all client patients
     * @param {String} patientId
     * @returns {String | String[]}
     */
    async getAllCLientPatientIds({patientId}) {
        const patientIdWithOutPrefix = patientId.replace(patientReferencePrefix, '');
        // Get the bwell master person from the client patient id
        let bwellMasterPerson = await this.bwellPersonFinder.getBwellPersonIdAsync({patientId: patientIdWithOutPrefix});
        // Fetch all patient linked with the bwell master person
        return await this.personToPatientIdsExpander.getPatientProxyIdsAsync({
            base_version: '4_0_0', id: `person.${bwellMasterPerson}`, includePatientPrefix: true
        });
    }
    /**
     * @description Fetches all the consent resources linked to a patient.
     * @param {String[]} patientIds
     * @returns Consent resource and a map between the client patient and the actual patient for which consent is to be updated
     */
    async getConsentResources(patientIds) {
        let allLinkedPatientIds = [];
        let linkedClientPatientIdMap = {};
        // TODO - Need to optimize
        for ( let patientId of patientIds) {
            let clientPatientIds = await this.getAllCLientPatientIds({patientId: patientId});
            clientPatientIds = Array.isArray(clientPatientIds) ? clientPatientIds : [clientPatientIds];
            // All the patient ids for which consents are to be fetched
            allLinkedPatientIds = [...allLinkedPatientIds, ...clientPatientIds];
            // Create a reverse relation object between the client patient and the main patient
            // TODO: Handle case when client patient ids are duplicate for patient ids.
            clientPatientIds.forEach(clientPatientId => {
                linkedClientPatientIdMap[clientPatientId] = patientId;
            });
        }
        // Query to fetch only the must updated consents for any patient
        const query = [
            {
                $match: {
                    $and: [
                        {'patient.reference': {$in: allLinkedPatientIds}},
                    ]
                }
            },
            {
                $sort: {
                    'meta.lastUpdated': -1
                }
            },
            {
                $group: {
                    _id: '$patient.reference',
                    latestDocument: {
                        $first: '$$ROOT'
                    }
                }
            },
            {
                $replaceRoot: {
                    newRoot: '$latestDocument'
                }
            }
        ];

        const consentDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Consent',
            base_version: '4_0_0',
        });

        // Match query is passed to determine if the whole aggregration pipeline is passed
        const cursor = await consentDataBaseQueryManager.findUsingAggregationAsync({
            query: query,
            projection: {},
            extraInfo: {matchQueryProvided: true}
        });
        const consentResources = await cursor.toArrayRawAsync();

        logInfo(`Total consent resources: ${consentResources.length}`, {});
        return [consentResources, linkedClientPatientIdMap];
    }

    /**
     * @description Retrieve all the access tags for a patient using its linked consent.
     * @param {Object} patientIdToResourceMap - The map which stores the patient id to resource map.
     * @returns {Object} - Returns a key-value pair for each patient and the simultaneous client that has access.
     */
    async getPatientSpecificSecurityAccessTag(patientIdToResourceMap) {
        // Object to store the access tags for each patient.
        // If patient 1 has provided access to Walgreens, a mapping for patientId 1 = [{system: access, code: walgreens}] is created.
        const patientIdAndSecurityAccessTagMap = {};

        const [consentResources, linkedClientPatientIdMap] = await this.getConsentResources(Object.keys(patientIdToResourceMap));
        consentResources.forEach((consentDoc) => {
            // Patient linked with the current consent resource.
            const consentPatientId = consentDoc.patient.reference;
            // Filtering out the consent's owner tags
            const clientsWithAccessPermission = consentDoc.meta.security
                .filter((security) => security.system === SecurityTagSystem.owner)
                // Currently consent owners will have access to resources, thus adding the owner as access
                // By updating system to access type.
                .map((security) => {
                    return {
                        'system': SecurityTagSystem.access,
                        'code': security.code
                    };
                });

            // Find the corresponding main patient ID in the linkedClientPatientIdMap and add the access tags.
            const correspondingMainPatientId = linkedClientPatientIdMap[consentPatientId];

            const existingSecurityAccessTags = patientIdAndSecurityAccessTagMap[correspondingMainPatientId] || [];
            // Since there can be duplicate security access, filter out only the unique ones.
            if (!existingSecurityAccessTags.some((existingTag) => existingTag.code === clientsWithAccessPermission.code)) {
                patientIdAndSecurityAccessTagMap[correspondingMainPatientId] = [...existingSecurityAccessTags, ...clientsWithAccessPermission];
            }
        });
        logDebug(
            'Access tags to be added for each patient:',
            { patientIdAndSecurityAccessTagMap: patientIdAndSecurityAccessTagMap }
        );
        return patientIdAndSecurityAccessTagMap;
    }

    /**
     * @description Remove and add the new access tags for each resource.
     * @param {Object} patientIdToResourceMap
     * @param {Object} requiredSecurityAccessTag
     */
    updateSecurityAccessTags(patientIdToResourceMap, requiredSecurityAccessTag) {
        let updatedResources = [];
        // For each patient id remove any previod access tags and create a new one as per consent.
        const patientIds = Object.keys(patientIdToResourceMap);
        patientIds.forEach((id) => {
            patientIdToResourceMap[id].forEach((resource) => {
                resource.meta.security = this.removeSecurityAccessTag(resource.meta.security);
                // If for the current patient id we need to create a access tag
                // requiredSecurityAccessTag[id] tells for which patient is we need to update access tags
                // first remove the current access tag.
                if (Object.keys(requiredSecurityAccessTag).includes(id)) {
                    // Updating the security tag.
                    resource.meta.security = [...resource.meta.security, ...requiredSecurityAccessTag[id]];
                }
                updatedResources.push(resource);
            });
        });
        return updatedResources;
    }

    /**
     * @description Updates the security tag and removes acess tags
     * @param {Object} security
     * @returns {Object[]} Return a list of security but removes the security that has a access tag.
     */
    removeSecurityAccessTag(security) {
        return security.filter((coding) => {
            return !coding.system.endsWith('/access');
        });
    }

    /**
     * For a list of patient ids returns the list of all resources for the patient.
     * @param {String[] | String} patientIds
     */
    async getAllResourcesRelatedToPatient({patientIds}) {
        patientIds = Array.isArray(patientIds) ? patientIds : [patientIds];
        const promises = [];
        let listOfResources = [];
        // Fetching all resources linked with patient id
        for (let [resourceType, pathToPatientReference] of Object.entries(this.patientFilterManager.getAllResourcesLinkedWithPatient())) {
            const databaseQueryManager = await this.databaseQueryFactory.createQuery({
                resourceType: resourceType,
                base_version: '4_0_0'
            });
            // For patient resource type we just need to pass the _sourceId or _uuid without prefix.
            let listOfIds = resourceType === 'Patient' ? patientIds.map((id) => id.replace(patientReferencePrefix, '')) : patientIds;
            const query = {
                $and: [
                    {[pathToPatientReference]: { $in: listOfIds }},
                    { 'meta.security.code': {$in: PATIENT_INITIATED_CONNECTION}}
                ]
            };
            // Creates a list of promises to getch all resources linked to a patient.
            promises.push(databaseQueryManager.findAsync({query: query}));
        }
        // Fetches all the resource cursors.
        const results = await Promise.all(promises);
        for (let currentResources of results) {
            // Maintains a list of resources linked to the patient.
            listOfResources = [...listOfResources, ...await currentResources.toArrayRawAsync()];
        }
        return listOfResources;
    }

    /**
     * Fetches all the resources related to a patient and updates the security tag for each resource
     * @param {String[]} patientIds
     */
    async processPatientRelatedResourcesAndUpdateSecurityTags({requestId, patientIds}) {
        // Fetch all the resources related to the client patients.
        const resourcesForPatient = await this.getAllResourcesRelatedToPatient({patientIds: patientIds});
        logInfo(`Total resources linked with patientIds: ${patientIds} are ${resourcesForPatient.length}`, {});
        // Call the sensitive data processor on all the resources.
        const updatedResources = await this.updateResourceSecurityAccessTag({
            resource: resourcesForPatient, returnUpdatedResources: true
        });
        if (updatedResources && updatedResources.length > 0) {
            updatedResources.forEach((resource) => {
                resource = FhirResourceCreator.createByResourceType(resource, resource.resourceType);
                this.databaseBulkInserter.patchFieldAsync({
                    requestId: requestId, resource: resource, fieldName: 'meta.security', fieldValue: resource.meta.security, upsert: false
                });
            });
            await this.databaseBulkInserter.executeAsync({requestId, base_version: '4_0_0'});
        }
    }

    /**
     * STEPS INVOLVED:
     * 1. Fetch all resources related to the patient for which consent has been updated.
     * 2. Upddates the security access tags.
     * @param {String} requestId
     * @param {Resource} resources
     */
    async processPatientConsentChange({requestId, resources}) {
        let clientPatientIds = [];
        // Retriving the patient id from consent resource
        for (let resource of resources) {
            let clientPatientIdForEachPatient = await this.getAllCLientPatientIds({patientId: resource.patient.reference});
            clientPatientIds = [...clientPatientIds, ...clientPatientIdForEachPatient];
        }
        logInfo(`In processPatientConsentChange: total clientPatientIds: ${clientPatientIds.length}`, {});
        await this.processPatientRelatedResourcesAndUpdateSecurityTags({
            requestId: requestId, patientIds: clientPatientIds
        });
    }

    /**
     * STEPS INVOLVED
     * 1. Filter out bwell master person
     * 2. Get all resources related to client patient of bwell master person
     * 3. Update the security access tags
     * @param {String} requestId
     * @param {Resource[]} resources
     */
    async processPersonLinkChange({requestId, resources}) {
        logInfo(`In processPersonChange Total bwellMasterPerson Resources: ${resources.length}`, {});
        const bwellMasterPersonIds = resources.map((resource) => {
            return resource._uuid;
        });
        const patientIds = await this.getPatientInitiatedConnectionPatientIds(bwellMasterPersonIds);
        logInfo(`In processPersonLinkChange: total patient initiated connection patientIds: ${patientIds.length}`, {});
        await this.processPatientRelatedResourcesAndUpdateSecurityTags({
            requestId: requestId, patientIds: patientIds,
        });
    }

    /**
     * @description Return list of patient ids that are patient data connection initiated and linked with bwell master person
     * @param {String[]} bwellMasterPersonIds
     * @returns {String[]}
     */
    async getPatientInitiatedConnectionPatientIds(bwellMasterPersonIds) {
        // Creating a database query manager for person collection
        const personDatabaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        // Fetch all patient ids linked to the bwell master person.
        let patientIds = await this.personToPatientIdsExpander.getPatientIdsFromPersonAsync({
            databaseQueryManager: personDatabaseQueryManager,
            personIds: bwellMasterPersonIds,
            totalProcessedPersonIds: new Set(),
            level: 1,
        });
        logInfo(`Number of patientIds linked with bwellMasterPersonIds: ${bwellMasterPersonIds} are ${patientIds.length}`, {});

        // Since patientIds can be either an uuid or normal id.
        const uuidQuery = {_uuid: {$in: patientIds}};
        const sourceIdQuery = {_sourceId: {$in: patientIds}};
        // Query to fetch only specific patients out of patientIds that are patientInitiatedConnection
        const query = {
            $and: [
                {$or: [uuidQuery, sourceIdQuery]},
                { 'meta.security': {$elemMatch: {'system': 'https://www.icanbwell.com/connectionType', 'code': {$in: PATIENT_INITIATED_CONNECTION}}}}
            ]
        };
        // Creating a database query manager for patient collection
        const patientDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Patient',
            base_version: '4_0_0',
        });
        const cursor = await patientDataBaseQueryManager.findAsync({query: query, options: { projection: {_id: 0, _uuid: 1}}});
        const patientUuid = await cursor.toArrayRawAsync();
        // Adding a prefix Patient to all patient resources.
        return patientUuid.map((patient) => {
            return `Patient/${patient._uuid}`;
        });
    }
}

module.exports = {
    SensitiveDataProcessor
};
