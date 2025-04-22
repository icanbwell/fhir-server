
class ResourceProccessedTracker {
    constructor() {
        this.uuidSet = new Set()
        this.sourceIdSet = new Set()
        this.sourceIdSourceAssigningAuthoritySet = new Set()
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    add(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._sourceId}`;
        const sourceIdSourceAssigningAuthorityKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._sourceId}|${resourceIdentifier._sourceAssigningAuthority}`;
        this.uuidSet.add(uuidKey);
        this.sourceIdSet.add(sourceIdKey);
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
