/**
 * Helpers to work out which resources a $graph read returned, for audit logging
 */

/**
 * @typedef {{_uuid: string, resourceType: string}} AuditedResource
 */

/**
 * Lists a resource and, when the graph attached related resources as contained, those resources. Only direct
 * children of the returned resource are listed, never anything deeper: a stored resource's own `contained`
 * (and anything nested in it) is client supplied, and its `_uuid` must not be taken as proof of what was read.
 * Resources without an internal id are skipped.
 * @param {Resource} resource
 * @param {Object} [options]
 * @param {boolean} [options.includeContained] true when the request asked the graph to attach related
 *  resources as contained
 * @param {WeakMap<Object, string>} [options.knownUuids] internal ids seen so far, by resource object.
 *  Serializing a resource strips its id in place, and one related resource object can be written under
 *  several parents.
 * @return {AuditedResource[]}
 */
function getAuditedResources (resource, { includeContained = false, knownUuids = new WeakMap() } = {}) {
    const listed = includeContained ? [resource, ...(resource.contained || [])] : [resource];
    return listed.flatMap((listedResource) => {
        if (listedResource._uuid) {
            knownUuids.set(listedResource, listedResource._uuid);
        }
        const _uuid = knownUuids.get(listedResource);
        return _uuid ? [{ _uuid, resourceType: listedResource.resourceType }] : [];
    });
}

/**
 * Lists the resources in a bundle that was returned without streaming
 * @param {Bundle} bundle
 * @param {Object} [options]
 * @param {boolean} [options.includeContained]
 * @return {AuditedResource[]}
 */
function getAuditedResourcesFromBundle (bundle, { includeContained = false } = {}) {
    return (bundle.entry || []).flatMap((entry) =>
        getAuditedResources(entry.resource, { includeContained })
    );
}

/**
 * Wraps a response streamer so that every resource written to it is added to `auditedResources`.
 * Everything else is forwarded to the original streamer untouched.
 * @param {Object} params
 * @param {BaseResponseStreamer} params.responseStreamer
 * @param {AuditedResource[]} params.auditedResources
 * @param {boolean} [params.includeContained]
 * @return {BaseResponseStreamer}
 */
function recordStreamedResources ({ responseStreamer, auditedResources, includeContained = false }) {
    /**
     * @type {WeakMap<Object, string>}
     */
    const knownUuids = new WeakMap();
    return new Proxy(responseStreamer, {
        get: (target, property) => {
            if (property === 'writeBundleEntryAsync') {
                return async ({ bundleEntry }) => {
                    // read the ids first: serializing the entry can strip them from the resource
                    const written = getAuditedResources(bundleEntry.resource, { includeContained, knownUuids });
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
