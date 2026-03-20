const resourcesMap = require('./generated.resource_types.json');
const { assertTypeEquals } = require('../../utils/assertType');
const { addElementsToSet } = require('../../utils/list.util');
const { EverythingRelatedResourcesMapper } = require('./everythingRelatedResourcesMapper');
const uscdiResourcesMap = require('./uscdi_resource_types.json');
const { AUTH_USER_TYPES } = require('../../constants');

const nonClinicalReachability = require('./generated.non_clinical_resources_reachablity.json');
/**
 * @type {Record<string, string[]>}
 */
const requiredResourcesMap = nonClinicalReachability['level2'];
/**
 * @type {Record<string, string[]>}
 */
const uscdiRequiredResourcesMap = nonClinicalReachability['uscdiLevel2'];

const nonClinicaResourcesSet = new Set(resourcesMap.nonClinicalResources);
const clinicalResourcesSet = new Set(resourcesMap.clinicalResources);
const uscdiClinicalResourcesSet = new Set(uscdiResourcesMap.clinicalResources);
const uscdiNonClinicalResourcesSet = new Set(uscdiResourcesMap.nonClinicalResources);

class EverythingRelatedResourceManager {
    /**
     *
     * @typedef EverythingRelatedResourceManagerConstructor
     * @property {string[]} resourceFilterList Resources which all allowed to be sent in response
     * @property {EverythingRelatedResourcesMapper} everythingRelatedResourceMapper
     * @property {string|null} userType - type of user making the request, used for determining resource restrictions
     *
     * @param {EverythingRelatedResourceManagerConstructor} options
     */
    constructor({ resourceFilterList, everythingRelatedResourceMapper, userType }) {
        /**
         * @type {boolean}
         */
        this._sendAllResources = true;

        this._isCmsPartnerUser = userType === AUTH_USER_TYPES.cmsPartnerUser;

        if (this._isCmsPartnerUser) {
            // CMS partner users are restricted to USCDI v3 resources
            this._sendAllResources = false;
            this.clinicalResources = new Set();
            this.nonClinicalResources = new Set();

            if (resourceFilterList) {
                for (const res of resourceFilterList) {
                    if (uscdiClinicalResourcesSet.has(res)) {
                        this.clinicalResources.add(res);
                    } else if (uscdiNonClinicalResourcesSet.has(res)) {
                        this.nonClinicalResources.add(res);
                    }
                }
            } else {
                addElementsToSet(this.clinicalResources, uscdiClinicalResourcesSet);
                addElementsToSet(this.nonClinicalResources, uscdiNonClinicalResourcesSet);
            }
        } else if (resourceFilterList) {
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
         * @type {EverythingRelatedResourcesMapper}
         */
        this.everythingRelatedResourceMapper = everythingRelatedResourceMapper;
        assertTypeEquals(everythingRelatedResourceMapper, EverythingRelatedResourcesMapper);

        this.topLevelResourceType = 'Patient';
    }

    /**
     * Checks if only clinical resources are requested
     * @param {boolean} includeNonClinicalResources
     * @returns {boolean}
     */
    isOnlyClinicalResourcesRequested(includeNonClinicalResources = true) {
        if (!this.sendAllResources) {
            // if sending resource filter, then check if non-clinical resources are requested
            return this.nonClinicalResources.size === 0;
        } else {
            // if include non clinical resources is false, then only clinical resources are requested
            return !includeNonClinicalResources;
        }
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

        const reachabilityMap = this._isCmsPartnerUser ? uscdiRequiredResourcesMap : requiredResourcesMap;
        const resourcePool = new Set();
        if (this.nonClinicalResources.size > 0) {
            for (const nonClinicalResource of this.nonClinicalResources) {
                addElementsToSet(resourcePool, reachabilityMap[nonClinicalResource]);
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

            addElementsToSet(resourceSet, this.clinicalResources);

            const resPool = this.getRequiredResourcesForNonClinicalResources();
            addElementsToSet(resourceSet, resPool, (r) => clinicalResourcesSet.has(r));
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

module.exports = { EverythingRelatedResourceManager };
