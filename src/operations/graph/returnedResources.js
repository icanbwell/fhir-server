/**
 * @typedef {{_uuid: string, resourceType: string}} AuditedResource
 */

/**
 * Collects the resources a $graph request returned, as reported by the code that returns them, so that
 * they can be audited
 */
class ReturnedResources {
    constructor () {
        /**
         * @type {AuditedResource[]}
         */
        this.resources = [];
        /**
         * @type {WeakMap<Object, string>}
         */
        this.uuids = new WeakMap();
    }

    /**
     * Notes the internal id of a resource before it is written. Serializing a resource strips its id in
     * place, and one related resource object can be returned under several parents.
     * @param {Resource} resource
     */
    remember (resource) {
        if (resource._uuid) {
            this.uuids.set(resource, resource._uuid);
        }
    }

    /**
     * Records a resource that was returned, and the related resources the graph attached to it as contained.
     * Resources without an internal id are skipped.
     * @param {Resource} resource
     * @param {Resource[]} [attachedContained] only resources the graph itself attached: a stored resource's
     *  own `contained` is client supplied, so its ids are never taken as proof of what was read
     */
    add (resource, attachedContained = []) {
        for (const returned of [resource, ...attachedContained]) {
            const _uuid = returned._uuid || this.uuids.get(returned);
            if (_uuid) {
                this.resources.push({ _uuid, resourceType: returned.resourceType });
            }
        }
    }
}

module.exports = {
    ReturnedResources
};
