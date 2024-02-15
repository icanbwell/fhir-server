/**
 * This class stores the tuple of resourceType and id to uniquely identify a resource
 */
class ResourceWithId {
    /**
     * returns key for resourceType and id combination
     * @param {string} resourceType
     * @param {string} id
     * @return {string}
     */
    static getReferenceKey (resourceType, id) {
        return `${resourceType}/${id}`;
    }

    /**
     * gets resourceType and id from reference
     * @param {string} reference
     * @return {null|{id: string, resourceType: string}}
     */
    static getResourceTypeAndIdFromReference (reference) {
        /**
         * @type {string[]}
         */
        const references = reference.split('/');
        if (references.length !== 2) {
            return null;
        }
        return {resourceType: references[0], id: references[1]};
    }

    /**
     * gets resourceType reference
     * @param {string} reference
     * @return {null|string}
     */
    static getResourceTypeFromReference (reference) {
        const reference1 = this.getResourceTypeAndIdFromReference(reference);
        return reference1?.resourceType;
    }

    /**
     * gets resourceType id
     * @param {string} reference
     * @return {null|string}
     */
    static getIdFromReference (reference) {
        const reference1 = this.getResourceTypeAndIdFromReference(reference);
        return reference1?.id;
    }
}

module.exports = {
    ResourceWithId
};
