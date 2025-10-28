/**
 * Mapper to be used when sending resources in $everything operation
 */
class ResourceMapper {
    map(resource) {
        return resource;
    }
}

/**
 * Mapper that returns only the _uuid as id and resourceType
 */
class UuidOnlyMapper extends ResourceMapper {
    map(resource) {
        return {
            resourceType: resource.resourceType,
            id: resource._uuid
        };
    }
}

module.exports = {
    ResourceMapper,
    UuidOnlyMapper
};
