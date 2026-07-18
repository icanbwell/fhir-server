const { BadRequestError } = require('../../utils/httpErrors');

class ViewResolver {
    /**
     * Phase 1: inline only. Later phases add stored lookup by id/url behind this same method.
     * @param {{ body: Object }} params
     * @returns {{ view: Object, inlineResources: Object[] }}
     */
    resolve ({ body }) {
        if (body && body.resourceType === 'ViewDefinition') {
            return { view: body, inlineResources: [] };
        }
        if (body && body.resourceType === 'Parameters' && Array.isArray(body.parameter)) {
            const viewParam = body.parameter.find((p) => p.name === 'viewResource');
            const view = viewParam && viewParam.resource;
            const inlineResources = body.parameter
                .filter((p) => p.name === 'resource' && p.resource)
                .map((p) => p.resource);
            if (!view) {
                throw new BadRequestError(new Error('$run requires a "viewResource" parameter containing a ViewDefinition'));
            }
            return { view, inlineResources };
        }
        throw new BadRequestError(new Error('$run requires a Parameters body with a viewResource, or a ViewDefinition body'));
    }
}

module.exports = { ViewResolver };
