/**
 * This middleware detects if the request is from a web browser user-agent and returns HTML rendered views
 */
const {resourceDefinitions} = require('../utils/resourceDefinitions');
const {
    searchFormData,
    advSearchFormData,
    lastUpdateStart,
    lastUpdateEnd,
    limit,
    searchUtils,
} = require('../utils/searchForm.util');
const {shouldReturnHtml} = require('../utils/requestHelpers');
const sanitize = require('sanitize-filename');
const {getCircularReplacer} = require('../utils/getCircularReplacer');
const Bundle = require('../fhir/classes/4_0_0/resources/bundle');

/**
 * middleware to render HTML
 * @param {SimpleContainer} container
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const htmlRenderer = ({container, req, res, next}) => {
    const parts = req.url.split(/[/?,&]+/);
    if (parts && parts.length > 2 && !parts.includes('raw=1') && parts[1] === '4_0_0' && shouldReturnHtml(req)) {
        // If the request is from a browser for HTML then return HTML page instead of json
        const resourceName = parts[2];
        // override the json function, so we can intercept the data being sent the client
        let oldJson = res.json;
        res.json = (data) => {
            /**
             * @type {Object|Object[]}
             */
            const parsedData = (data instanceof Bundle) ?
                data.toJSONInternal() :
                JSON.parse(JSON.stringify(data, getCircularReplacer()));
            let total = 0;
            if (parsedData.total) {
                total = parsedData.total;
            }
            let meta = null;
            if (parsedData.meta) {
                meta = parsedData.meta;
            }
            /**
             * @type {Object[]}
             */
            let resources;
            // /**
            //  * @type {Bundle}
            //  */
            // let bundle;
            if (!Array.isArray(parsedData) && parsedData.resourceType === 'Bundle') {
                // bundle = data;
                // unbundle
                // resources = parsedData.entry ? parsedData.entry.map((entry) => entry.resource) : [];
                resources = parsedData.entry ? parsedData.entry : [];
            } else if (!Array.isArray(parsedData)) {
                resources = [parsedData];
                // bundle = new Bundle({
                //     type: 'searchset',
                //     entry: [
                //         new BundleEntry(
                //             {
                //                 resource: parsedData
                //             }
                //         )
                //     ]
                // });
            } else {
                resources = parsedData;
            }

            res.json = oldJson; // set function back to avoid the 'double-send'
            res.set('Content-Type', 'text/html');
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1.
            res.set('Pragma', 'no-cache'); // HTTP 1.0.
            res.set('Expires', '0');
            const env = require('var');

            const resourceDefinition = resourceDefinitions.find((r) => r.name === resourceName);

            /**
             * @type {ScopesManager}
             */
            const scopesManager = container.scopesManager;
            /**
             * @type {string|undefined}
             */
            const scope = scopesManager.getScopeFromRequest({req});

            const admin = scopesManager.getAdminScopes({scope}).length > 0;

            const options = {
                meta: meta,
                resources: resources,
                // bundle: bundle,
                url: req.url,
                body: req.body,
                idpUrl: env.AUTH_CODE_FLOW_URL,
                clientId: env.AUTH_CODE_FLOW_CLIENT_ID,
                total: total,
                resourceDefinition: resourceDefinition,
                environment: env.ENV || 'local',
                formData: searchFormData(req, resourceName),
                advSearchFormData: advSearchFormData(req, resourceName),
                resourceName: resourceName,
                currentYear: new Date().getFullYear(),
                lastUpdateStart: lastUpdateStart(req, 0),
                lastUpdateEnd: lastUpdateEnd(req, 1),
                limit: limit,
                searchUtils: searchUtils,
                searchMethod: req.method,
                oauth_scope: scope,
                admin: admin,
                requestId: req.id,
                user: req.user
            };

            if (resourceDefinition) {
                if (req.url && req.url.includes('/_search')) {
                    return res.status(200).render(__dirname + '/../views/pages/SearchResult', options);
                } else {
                    const filePath = __dirname + '/../views/pages/' + sanitize(resourceName);
                    return res.render(filePath, options,
                        (err, html) => res.send(html));
                }
            } else {
                return res.render(__dirname + '/../views/pages/index', options);
            }
        };

    }
    next();
};

module.exports.htmlRenderer = htmlRenderer;
