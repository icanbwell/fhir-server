const resourcesMap = require('./generated.resource_types.json');
const { assertTypeEquals } = require('../../utils/assertType');
const { addElementsToSet } = require('../../utils/list.util');
const { SummaryRelatedResourcesMapper } = require('./summaryRelatedResourcesMapper');

/**
 * @type {Record<string, string[]>}
 */
const requiredRsourcesMap =
    require('./generated.non_clinical_resources_reachablity.json')['level2'];

const nonClinicaResourcesSet = new Set(resourcesMap.nonClinicalResources);
const clinicalResourcesSet = new Set(resourcesMap.clinicalResources);

class SummaryRelatedResourceManager {
    /**
     *
     * @typedef SummaryRelatedResourceManagerConstructor
     * @property {string[]} resourceFilterList Resources which all allowed to be sent in response
     * @property {SummaryRelatedResourcesMapper} summaryRelatedResourceMapper
     *
     * @param {SummaryRelatedResourceManagerConstructor} options
     */
    constructor({ resourceFilterList, summaryRelatedResourceMapper }) {
        /**
         * @type {boolean}
         */
        this._sendAllResources = true;

        if (resourceFilterList) {
            this._sendAllResources = false;
            /**
             * @type {Set<string> | undefined}
             */
            this.clinicalResources = new Set();
            /**
             * @type {Set<string> | undefined}
             */
            this.nonClinicalResources = new Set();

            // Categorize resources into clinical and non-clinical
            for (const res of resourceFilterList) {
                if (nonClinicaResourcesSet.has(res)) {
                    this.nonClinicalResources.add(res);
                } else if (clinicalResourcesSet.has(res)) {
                    this.clinicalResources.add(res);
                }
            }
        }

        /**
         * @type {SummaryRelatedResourcesMapper}
         */
        this.summaryRelatedResourceMapper = summaryRelatedResourceMapper;
        assertTypeEquals(summaryRelatedResourceMapper, SummaryRelatedResourcesMapper);

        this.topLevelResourceType = 'Patient';
    }

    /**
     * @type {boolean}
     */
    get sendAllResources() {
        return this._sendAllResources;
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
    getRequiredResourcesForNonClinicalResources() {
        if (this.sendAllResources) {
            return null;
        }

        if (this._nonClinicalResourcePool) {
            return this._nonClinicalResourcePool;
        }

        const resourcePool = new Set();
        if (this.nonClinicalResources.size > 0) {
            for (const nonClinicalResource of this.nonClinicalResources) {
                addElementsToSet(resourcePool,requiredRsourcesMap[nonClinicalResource])
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

            addElementsToSet(resourceSet, this.clinicalResources)

            const resPool = this.getRequiredResourcesForNonClinicalResources();
            addElementsToSet(resourceSet, resPool, (r) => clinicalResourcesSet.has(r));
        }

        this._clinicalResourcesMap = this.summaryRelatedResourceMapper.relatedResources(
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

module.exports = { SummaryRelatedResourceManager };
