
class ResourceProccessedTracker {
    constructor() {
        this.uuidSet = new Set()
        this.sourceIdSourceAssigningAuthoritySet = new Set()
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    add(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdSourceAssigningAuthorityKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._sourceId}|${resourceIdentifier._sourceAssigningAuthority}`;
        this.uuidSet.add(uuidKey);
        this.sourceIdSourceAssigningAuthoritySet.add(sourceIdSourceAssigningAuthorityKey);
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    has(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdSourceAssigningAuthorityKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._sourceId}|${resourceIdentifier._sourceAssigningAuthority}`;

        return this.uuidSet.has(uuidKey) || this.sourceIdSourceAssigningAuthoritySet.has(sourceIdSourceAssigningAuthorityKey);
    }

}

module.exports = { ResourceProccessedTracker };
