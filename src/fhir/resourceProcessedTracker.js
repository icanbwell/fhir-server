
class ResourceProccessedTracker {
    constructor() {
        this.uuidSet = new Set()
        this.sourceIdSet = new Set()
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    add(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdKey = `${resourceIdentifier.resourceType}/${resourceIdentifier.id}|${resourceIdentifier._sourceAssigningAuthority}`;
        this.uuidSet.add(uuidKey);
        this.sourceIdSet.add(sourceIdKey);
    }

    /**
     * @param {import('./resourceIdentifier').ResourceIdentifier} resourceIdentifier
     */
    has(resourceIdentifier) {
        const uuidKey = `${resourceIdentifier.resourceType}/${resourceIdentifier._uuid}`;
        const sourceIdKey = `${resourceIdentifier.resourceType}/${resourceIdentifier.id}|${resourceIdentifier._sourceAssigningAuthority}`;

        return this.uuidSet.has(uuidKey) || this.sourceIdSet.has(sourceIdKey);
    }

}

module.exports = { ResourceProccessedTracker };
