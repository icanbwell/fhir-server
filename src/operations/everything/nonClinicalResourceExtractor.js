/**
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
 */

const { NestedPropertyReader } = require('../../utils/nestedPropertyReader');
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');

const NonClinicalDataFields = require('./generated.non_clinical_resources_fields.json');
const resourcesMap = require('./generated.resource_types.json');

const nonClinicaResourcesSet = new Set(resourcesMap.nonClinicalResources);

class NonClinicalReferenesExtractor {
    /**
     * @typedef {Object} NonClinicalReferenesExtractorOptions
     * @property {string[]} resourcesToExclude List of resources to exclude. Always given more preference to this field
     * @property {string[] | Set<string> | null} resourcePool List of resources to allowed to be inlcuded. If a resource is present in both resourcesToExclude and resourcePool, resourcesTypeToExclude will have preference
     *
     * @param {NonClinicalReferenesExtractorOptions}
     */
    constructor({ resourcesTypeToExclude, resourcePool }) {
        /**
         * @type {Set<string>}
         */
        this.resourcesTypeToExclude = new Set(resourcesTypeToExclude);
        /**
         * @type {Set<string> | null}
         */
        this.resourcePool = null;

        if (resourcePool instanceof Set) {
            this.resourcePool = resourcePool;
        } else if (Array.isArray(resourcePool)) {
            this.resourcePool = new Set(resourcePool);
        }

        /**
         * @type {NestedResourceReferences}
         */
        this._nestedResourceReferences = {};
    }

    /**
     * @type {NestedResourceReferences}
     */
    get nestedResourceReferences() {
        return this._nestedResourceReferences;
    }

    /**
     * @param {Resource} resource
     */
    async processResource(resource) {
        let resourceNonClinicalDataFields = NonClinicalDataFields[resource.resourceType];

        for (const path of resourceNonClinicalDataFields ?? []) {
            /**
             * @type {string[]}
             */
            let references = NestedPropertyReader.getNestedProperty({
                obj: resource,
                path: path
            });
            if (references) {
                if (!Array.isArray(references)) {
                    references = [references];
                }

                // allow only Binary references in custom DocumentReference field
                if(resource.resourceType === 'DocumentReference' && path === 'content.attachment.url') {
                    let updatedReferences = [];
                    references.forEach(ref => {
                        let { id, resourceType } = ReferenceParser.parseReference(ref);
                        if(resourceType === 'Binary') {
                            if (!isUuid(id)) {
                                id = generateUUIDv5(`${id}|${resource._sourceAssigningAuthority}`);
                                updatedReferences.push(`Binary/${id}`);
                            } else {
                                updatedReferences.push(ref);
                            }
                        }
                    });
                    references = updatedReferences;
                }

                // query Practitioner references from _sourceId
                if (references.some(ref => ref.split('/')[0] === 'Practitioner')) {
                    references = references.filter(ref => ref.split('/')[0] !== 'Practitioner');

                    let sourceReferencePath = path.replace('_uuid', '_sourceId');
                    let sourceIdReferences = NestedPropertyReader.getNestedProperty({
                        obj: resource,
                        path: sourceReferencePath
                    });
                    if (!Array.isArray(sourceIdReferences)) {
                        sourceIdReferences = [sourceIdReferences];
                    }
                    let practitionerReferences = sourceIdReferences.filter(ref => ref.split('/')[0] === 'Practitioner');
                    references = references.concat(practitionerReferences);
                }

                for (const reference of references) {
                    const { id: referenceId, resourceType: referenceResourceType } =
                        ReferenceParser.parseReference(reference);
                    if (
                        !this.resourcesTypeToExclude.has(referenceResourceType) &&
                        (!this.resourcePool || this.resourcePool.has(referenceResourceType)) &&
                        nonClinicaResourcesSet.has(referenceResourceType)
                    ) {
                        if (!this._nestedResourceReferences[referenceResourceType]) {
                            this._nestedResourceReferences[referenceResourceType] = new Set();
                        }

                        this._nestedResourceReferences[referenceResourceType] =
                            this._nestedResourceReferences[referenceResourceType].add(referenceId);
                    }
                }
            }
        }
    }
}

module.exports = { NonClinicalReferenesExtractor };
