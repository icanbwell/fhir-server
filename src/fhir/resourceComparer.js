class ResourceComparer {
    /**
     * Returns whether two resources are same
     * @param {{id:string, resourceType: string, _uuid: string, _sourceAssigningAuthority: string}} first
     * @param {{id:string, resourceType: string, _uuid: string, _sourceAssigningAuthority: string}} second
     * @return {boolean}
     */
    static isSameResourceByIdAndSecurityTag({first, second}) {
        if (first.resourceType !== second.resourceType) {
            return false;
        }
        return (
            (first._uuid && (first._uuid === second._uuid)) || // either the uuid matches
            (
                // or id and sourceAssigningAuthority matches
                first.id === second.id &&
                first._sourceAssigningAuthority === second._sourceAssigningAuthority
            )
        );
    }
}

module.exports = {
    ResourceComparer
};
