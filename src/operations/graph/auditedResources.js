/**
 * Helpers to work out which resources a $graph read returned, for audit logging
 */

/**
 * @typedef {{_uuid: string, resourceType: string}} AuditedResource
 */

/**
 * Lists a resource and any resources contained in it. Only resources that carry an internal id are listed:
 * a resource contained natively in a stored resource has none, and is not a resource the caller read on its own.
 * @param {Resource} resource
 * @param {WeakMap<Object, string>} [knownUuids] internal ids seen so far, by resource object. Serializing a
 *  resource strips its id in place, and one related resource object can be written under several parents.
 * @return {AuditedResource[]}
 */
function getAuditedResources (resource, knownUuids = new WeakMap()) {
    if (resource._uuid) {
        knownUuids.set(resource, resource._uuid);
    }
    const _uuid = knownUuids.get(resource);
    return [
        ...(_uuid ? [{ _uuid, resourceType: resource.resourceType }] : []),
        ...(resource.contained || []).flatMap((contained) => getAuditedResources(contained, knownUuids))
    ];
}

/**
 * Lists the resources in a bundle that was returned without streaming
 * @param {Bundle} bundle
 * @return {AuditedResource[]}
 */
function getAuditedResourcesFromBundle (bundle) {
    return (bundle.entry || []).flatMap((entry) => getAuditedResources(entry.resource));
}

/**
 * Wraps a response streamer so that every resource written to it is added to `auditedResources`.
 * Everything else is forwarded to the original streamer untouched.
 * @param {Object} params
 * @param {BaseResponseStreamer} params.responseStreamer
 * @param {AuditedResource[]} params.auditedResources
 * @return {BaseResponseStreamer}
 */
function recordStreamedResources ({ responseStreamer, auditedResources }) {
    /**
     * @type {WeakMap<Object, string>}
     */
    const knownUuids = new WeakMap();
    return new Proxy(responseStreamer, {
        get: (target, property) => {
            if (property === 'writeBundleEntryAsync') {
                return async ({ bundleEntry }) => {
                    // read the ids first: serializing the entry can strip them from the resource
                    const written = getAuditedResources(bundleEntry.resource, knownUuids);
                    await target.writeBundleEntryAsync({ bundleEntry });
                    // not push(...written): spreading a very large list into call arguments throws a RangeError
                    for (const resource of written) {
                        auditedResources.push(resource);
                    }
                };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

module.exports = {
    getAuditedResources,
    getAuditedResourcesFromBundle,
    recordStreamedResources
};
