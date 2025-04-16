/**
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
 */

const { NestedPropertyReader } = require('../../utils/nestedPropertyReader');
const { ReferenceParser } = require('../../utils/referenceParser');

const NonClinicalDataFields = require('../../graphs/patient/generated.non_clinical_resources_fields.json');

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
            let references = NestedPropertyReader.getNestedProperty({
                obj: resource,
                path: path
            });
            if (references) {
                if (!Array.isArray(references)) {
                    references = [references];
                }
                for (const reference of references) {
                    const { id: referenceId, resourceType: referenceResourceType } =
                        ReferenceParser.parseReference(reference);
                    if (
                        !this.resourcesTypeToExclude.has(referenceResourceType) &&
                        (!this.resourcePool || this.resourcePool.has(referenceResourceType))
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
