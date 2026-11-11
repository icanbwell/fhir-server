/**
 * Helpers to work out which resources a $graph read returned, for audit logging
 */

/**
 * @typedef {{_uuid: string, resourceType: string}} AuditedResource
 */

/**
 * Lists a resource and any resources contained in it
 * @param {Resource} resource
 * @return {AuditedResource[]}
 */
function getAuditedResources (resource) {
    return [
        { _uuid: resource._uuid, resourceType: resource.resourceType },
        ...(resource.contained || []).flatMap((contained) => getAuditedResources(contained))
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
    return new Proxy(responseStreamer, {
        get: (target, property) => {
            if (property === 'writeBundleEntryAsync') {
                return async ({ bundleEntry }) => {
                    await target.writeBundleEntryAsync({ bundleEntry });
                    auditedResources.push(...getAuditedResources(bundleEntry.resource));
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
