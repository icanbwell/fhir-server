const resourcesMap = require('../../graphs/patient/generated.clinical_resources.json');
const { assertTypeEquals } = require('../../utils/assertType');
const { EverythingRelatedResourcesMapper } = require('./everythingRelatedResourcesMapper');

/**
 * @type {Record<string, string[]>}
 */
const requiredRsourcesMap =
    require('../../graphs/patient/generated.non_clinical_resources_reachablity.json')['level2'];

const nonClinicaResourcesSet = new Set(resourcesMap.nonClinicalResources);
const clinicalResourcesSet = new Set(resourcesMap.clinicalResources);

/**
 * @type {Record<string, Set<string>>}
 */
let requiredResourcesSet;

class ResourceSetManager {
    /**
     *
     * @typedef ResourceSetManagerConstructor
     * @property {string[]} resourceFilterList Resources which all allowed to be sent in response
     * @property {EverythingRelatedResourcesMapper} everythingRelatedResourceMapper
     *
     * @param {ResourceSetManagerConstructor} options
     */
    constructor({ resourceFilterList, everythingRelatedResourceMapper }) {
        /**
         * @type {boolean}
         */
        this._allResourcesAllowed = true;

        if (resourceFilterList) {
            this._allResourcesAllowed = false;
            /**
             * @type {Set<string> | undefined}
             */
            this.allowedNonClinicalResources = new Set();
            /**
             * @type {Set<string> | undefined}
             */
            this.allowedClinicalResources = new Set();

            // Categorize resources into clinical and non-clinical
            for (const res of resourceFilterList) {
                if (nonClinicaResourcesSet.has(res)) {
                    this.allowedNonClinicalResources.add(res);
                } else if (clinicalResourcesSet.has(res)) {
                    this.allowedClinicalResources.add(res);
                }
            }
        }

        /**
         * @type {EverythingRelatedResourcesMapper}
         */
        this.everythingRelatedResourceMapper = everythingRelatedResourceMapper;
        assertTypeEquals(everythingRelatedResourceMapper, EverythingRelatedResourcesMapper);

        this.topLevelResourceType = 'Patient';
    }

    /**
     * @type {Set<string>|undefined}
     */
    get nonClinicalResources() {
        return this.allowedNonClinicalResources;
    }

    /**
     * @type {Set<string>|undefined}
     */
    get clinicalResources() {
        return this.allowedClinicalResources;
    }

    /**
     * @type {boolean}
     */
    get sendAllResources() {
        return this._allResourcesAllowed;
    }

    /**
     * Get required resource map for fetching non-clinical
     * @type {Record<string, Set<string>}
     */
    static getRequiredResourceMapForNonClinical() {
        if (!requiredResourcesSet) {
            requiredResourcesSet = {};
            for (const [resource, references] of Object.entries(requiredRsourcesMap)) {
                requiredResourcesSet[resource] = new Set(references);
            }
        }

        return requiredResourcesSet;
    }

    /**
     * List of resources that are required to be fetched
     * for getting all the nonClinical resources for the given types
     *
     * Returns null if there is no restriction in sending the resources
     * Returns empty set if nonclinical resources are not passed in filter
     *
     * @type {Set<string> | null}
     */
    getResourcePoolForNonClinicalResources() {
        if (this.sendAllResources) {
            return null;
        }

        if (this._nonClinicalResourcePool) {
            return this._nonClinicalResourcePool;
        }

        const resourcePool = new Set();
        if (this.nonClinicalResources.size > 0) {
            const lookupMap = ResourceSetManager.getRequiredResourceMapForNonClinical();
            for (const nonClinicalResource of this.nonClinicalResources) {
                if (lookupMap[nonClinicalResource]) {
                    lookupMap[nonClinicalResource].forEach((res) => {
                        resourcePool.add(res);
                    });
                }
            }
        }

        this._nonClinicalResourcePool = resourcePool;

        return this._nonClinicalResourcePool;
    }

    /**
     * Returns ResourceMapper for fetching clinical resources that are either passed in _type
     * or required for fetching nonClinical data
     *
     * If no type are passed, all the clinical resources are included
     */
    getRelatedResourcesMap() {
        if (this._clinicalResourcesMap) {
            return this._clinicalResourcesMap;
        }

        /**
         * @type {Set<string>|null}
         */
        let resourceSet = null;

        // Resource set should include super-set of allowedClinical + clinical required for non-clinical
        if (this.clinicalResources || this.nonClinicalResources) {
            resourceSet = new Set();

            this.clinicalResources?.forEach((r) => {
                resourceSet.add(r);
            });

            const resPool = this.getResourcePoolForNonClinicalResources();
            if (resPool) {
                resPool.forEach((r) => {
                    if (clinicalResourcesSet.has(r)) {
                        resourceSet.add(r);
                    }
                });
            }
        }

        this._clinicalResourcesMap = this.everythingRelatedResourceMapper.relatedResources(
            this.topLevelResourceType,
            resourceSet
        );

        return this._clinicalResourcesMap;
    }

    allowedToBeSent(resource) {
        if (this.sendAllResources) {
            return true;
        }

        return this.clinicalResources?.has(resource) || this.nonClinicalResources?.has(resource);
    }
}

module.exports = { ResourceSetManager };
