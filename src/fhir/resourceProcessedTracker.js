
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
        const sourceIdKey = `${resourceIdentifier.resourceType}/${resourceIdentifier.id}`;
        const sourceIdSourceAssigningAuthorityKey = `${resourceIdentifier.resourceType}/${resourceIdentifier.id}|${resourceIdentifier._sourceAssigningAuthority}`;
        this.uuidSet.add(uuidKey);
        this.sourceIdSet.add(sourceIdKey);
        this.sourceIdSourceAssigningAuthoritySet.add(sourceIdSourceAssigningAuthorityKey);
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    has(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdSourceAssigningAuthorityKey = `${resourceIdentifier.resourceType}/${resourceIdentifier.id}|${resourceIdentifier._sourceAssigningAuthority}`;

        return this.uuidSet.has(uuidKey) || this.sourceIdSourceAssigningAuthoritySet.has(sourceIdSourceAssigningAuthorityKey);
    }

}

module.exports = { ResourceProccessedTracker };
