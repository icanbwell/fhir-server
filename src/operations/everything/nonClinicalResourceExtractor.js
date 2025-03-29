
/**
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
 */

const { NestedPropertyReader } = require("../../utils/nestedPropertyReader");
const { ReferenceParser } = require("../../utils/referenceParser");

const NonClinicalDataFields = require('../../graphs/patient/generated.non_clinical_resources_fields.json');

class NonClinicalReferenesExtractor {
    /**
     * @param {string[]} resourcesToExclude
     */
    constructor({
        resourcesTypeToExclude
    }) {
        /**
         * @type {string[]}
         */
        this.resourcesTypeToExclude = resourcesTypeToExclude;

        /**
         * @type {NestedResourceReferences}
         */
        this._nestedResourceReferences = {}
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
                    if (!this.resourcesTypeToExclude.includes(referenceResourceType)) {
                        if (!this._nestedResourceReferences[referenceResourceType]) {
                            this._nestedResourceReferences[referenceResourceType] = new Set();

                        }

                        this._nestedResourceReferences[referenceResourceType] =
                            this._nestedResourceReferences[referenceResourceType].add(
                                referenceId
                            );
                    }
                }
            }
        }
    }
}

module.exports = { NonClinicalReferenesExtractor }
