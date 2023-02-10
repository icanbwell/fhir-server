/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */
const {AdminLogManager} = require('../admin/adminLogManager');
const sanitize = require('sanitize-filename');
const {shouldReturnHtml} = require('../utils/requestHelpers');
const env = require('var');
const {isTrue} = require('../utils/isTrue');
const {HttpResponseStreamer} = require('../utils/httpResponseStreamer');
const {assertIsValid} = require('../utils/assertType');
const {FhirResponseStreamer} = require('../utils/fhirResponseStreamer');
const {generateUUID} = require('../utils/uid.util');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { REQUEST_ID_HEADER } = require('../constants');

/**
 * shows indexes
 * @param {import('http').IncomingMessage} req
 * @param {SimpleContainer} container
 * @param {import('express').Response} res
 * @param {boolean|undefined} [filterToProblems]
 * @returns {Promise<*>}
 */
async function showIndexesAsync(
    {
        req, container, res,
        filterToProblems
    }) {
    console.log(`showIndexesAsync: req.query: ${JSON.stringify(req.query)}`);
    const audit = req.query['audit'];
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;
    const json = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync(
        {
            audit: audit ? true : false,
            filterToProblems: filterToProblems
        }
    );
    if (shouldReturnHtml(req)) {
        const filePath = __dirname + '/../views/admin/pages/indexes';
        return res.render(filePath, {
            collections: json
        });
    } else {
        return res.json(json);
    }
}

/**
 * synchronizes indexes
 * @param {import('express').Request} req
 * @param {SimpleContainer} container
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function synchronizeIndexesAsync(
    {
        req,
        container,
        res
    }
) {
    console.log(`synchronizeIndexesAsync: req.query: ${JSON.stringify(req.query)}`);
    const audit = req.query['audit'];
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;

    // return response and then continue processing
    const htmlContent = '<!DOCTYPE html><html><body><script>setTimeout(function(){window.location.href = "/admin/indexProblems";}, 5000);</script><p>Started Synchronizing indexes. Web page redirects after 5 seconds.</p></body></html>';
    res.set('Content-Type', 'text/html');
    res.send(Buffer.from(htmlContent));
    res.end();
    await indexManager.synchronizeIndexesWithConfigAsync({
        audit: audit
    });
    return;
}

/**
 * Handles admin routes
 * @param {function (): SimpleContainer} fnCreateContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdmin(
    fnCreateContainer,
    req,
    res
) {
    /**
     * converts bundleEntry to html
     * @param {BundleEntry} bundleEntry
     * @returns {string}
     */
    function getHtmlForBundleEntry(bundleEntry) {
        const operation = bundleEntry.request ? `${bundleEntry.request.method} ` : '';
        return `<div>${operation}${bundleEntry.resource.resourceType}/${bundleEntry.resource.id}</div>\n`;
    }

    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        const operation = req.params['op'];
        console.log(`op=${operation}`);

        // set up all the standard services in the container
        /**
         * @type {SimpleContainer}
         */
        const container = fnCreateContainer();
        /**
         * @type {ScopesManager}
         */
        const scopesManager = container.scopesManager;
        /**
         * @type {string|undefined}
         */
        const scope = scopesManager.getScopeFromRequest({req});
        /**
         * @type {string[]}
         */
        const adminScopes = scopesManager.getAdminScopes({scope});

        if (!isTrue(env.AUTH_ENABLED) || adminScopes.length > 0) {
            switch (operation) {
                case 'searchLog':
                case 'personPatientLink':
                case 'patientData':
                case 'personMatch': {
                    const parameters = {};
                    const filePath = __dirname + `/../views/admin/pages/${sanitize(operation)}`;
                    return res.render(filePath, parameters);
                }

                case 'searchLogResults': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const id = req.query['id'];
                    if (id) {
                        const adminLogManager = new AdminLogManager();
                        const json = await adminLogManager.getLogAsync(id);
                        return res.json(json);
                    }
                    return res.json({
                        message: 'No id passed'
                    });
                }

                case 'showPersonToPersonLink': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const bwellPersonId = req.query['bwellPersonId'];
                    if (bwellPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.showPersonToPersonLinkAsync({
                            bwellPersonId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No bwellPersonId: ${bwellPersonId} passed`
                    });
                }

                case 'deletePerson': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const personId = req.query['personId'];
                    if (personId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.deletePersonAsync({
                            requestId: req.id,
                            personId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No personId: ${personId} passed`
                    });
                }

                case 'createPersonToPersonLink': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const bwellPersonId = req.query['bwellPersonId'];
                    const externalPersonId = req.query['externalPersonId'];
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPersonLinkAsync({
                            bwellPersonId,
                            externalPersonId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No bwellPersonId: ${bwellPersonId} or externalPersonId: ${externalPersonId} passed`
                    });
                }

                case 'removePersonToPersonLink': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const bwellPersonId = req.query['bwellPersonId'];
                    const externalPersonId = req.query['externalPersonId'];
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.removePersonToPersonLinkAsync({
                            bwellPersonId,
                            externalPersonId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No bwellPersonId: ${bwellPersonId} or externalPersonId: ${externalPersonId} passed`
                    });
                }

                case 'createPersonToPatientLink': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const externalPersonId = req.query['externalPersonId'];
                    const patientId = req.query['patientId'];
                    if (patientId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPatientLinkAsync({
                            externalPersonId,
                            patientId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No patientId: ${patientId} passed`
                    });
                }

                case 'deletePatientDataGraph': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const patientId = req.query['id'];
                    const sync = req.query['sync'];
                    if (patientId) {
                        /**
                         * @type {string[]}
                         */
                        let scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';
                        // eslint-disable-next-line no-unused-vars
                        let {success} = scopeChecker(resourceType, accessRequested, scopes);
                        if (!success) {
                            let errorMessage = 'user with scopes [' + scopes +
                                '] failed access check to [' + resourceType + '.' + accessRequested + ']';
                            const operationOutcome = new OperationOutcome({
                                issue: [
                                    new OperationOutcomeIssue(
                                        {
                                            severity: 'error',
                                            code: 'forbidden',
                                            diagnostics: errorMessage
                                        }
                                    )
                                ]
                            });
                            return res.json(operationOutcome.toJSON());
                        }

                        /**
                         * @type {AdminPersonPatientDataManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientDataManager;
                        if (sync) {
                            const json = await adminPersonPatientLinkManager.deletePatientDataGraphAsync({
                                req,
                                res,
                                patientId,
                                responseStreamer: null
                            });
                            return res.json(json);
                        } else {
                            /**
                             * @type {BaseResponseStreamer}
                             */
                            const responseStreamer = shouldReturnHtml(req) ?
                                new HttpResponseStreamer({
                                    response: res,
                                    requestId: req.id,
                                    title: 'Delete Patient Data Graph',
                                    html: '<h1>Delete Patient Data Graph</h1>\n' + '<div>' +
                                        `Started delete of ${patientId}.  This may take a few seconds.  ` +
                                        '</div>\n',
                                    fnGetHtmlForBundleEntry: getHtmlForBundleEntry
                                }) :
                                new FhirResponseStreamer({
                                    response: res,
                                    requestId: req.id,
                                    bundleType: 'batch-response'
                                });
                            await responseStreamer.startAsync();
                            await adminPersonPatientLinkManager.deletePatientDataGraphAsync({
                                req,
                                res,
                                patientId,
                                responseStreamer
                            });
                            await responseStreamer.writeAsync({
                                content: '<div>Finished</div>\n'
                            });
                            await responseStreamer.endAsync();
                            return;
                        }
                    }
                    return res.json({
                        message: `No id: ${patientId} passed`
                    });
                }

                case 'deletePersonDataGraph': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const personId = req.query['id'];
                    if (personId) {
                        /**
                         * @type {string[]}
                         */
                        let scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';
                        // eslint-disable-next-line no-unused-vars
                        let {success} = scopeChecker(resourceType, accessRequested, scopes);
                        if (!success) {
                            let errorMessage = 'user with scopes [' + scopes +
                                '] failed access check to [' + resourceType + '.' + accessRequested + ']';
                            const operationOutcome = new OperationOutcome({
                                issue: [
                                    new OperationOutcomeIssue(
                                        {
                                            severity: 'error',
                                            code: 'forbidden',
                                            diagnostics: errorMessage
                                        }
                                    )
                                ]
                            });
                            return res.json(operationOutcome.toJSON());
                        }
                        /**
                         * @type {AdminPersonPatientDataManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientDataManager;
                        /**
                         * @type {BaseResponseStreamer}
                         */
                        const responseStreamer = shouldReturnHtml(req) ?
                            new HttpResponseStreamer({
                                response: res,
                                requestId: req.id,
                                title: 'Delete Person Data Graph',
                                html: '<h1>Delete Person Data Graph</h1>\n' + '<div>' +
                                    `Started delete of ${personId}.  This may take a few seconds.  ` +
                                    '</div>\n',
                                fnGetHtmlForBundleEntry: getHtmlForBundleEntry
                            }) :
                            new FhirResponseStreamer({
                                response: res,
                                requestId: req.id,
                                bundleType: 'batch-response'
                            });

                        await responseStreamer.startAsync();
                        await adminPersonPatientLinkManager.deletePersonDataGraphAsync({
                            req,
                            res,
                            personId,
                            responseStreamer
                        });
                        await responseStreamer.writeAsync({
                            content: '<div>Finished</div>\n'
                        });
                        await responseStreamer.endAsync();
                        return;
                    }
                    return res.json({
                        message: `No id: ${personId} passed`
                    });
                }


                case 'indexes': {
                    return await showIndexesAsync(
                        {
                            req, container, res,
                            filterToProblems: false
                        }
                    );
                }

                case 'indexProblems': {
                    return await showIndexesAsync(
                        {
                            req, container, res,
                            filterToProblems: true
                        }
                    );
                }

                case 'synchronizeIndexes': {
                    return await synchronizeIndexesAsync(
                        {
                            req,
                            container,
                            res
                        }
                    );
                }

                case 'runPersonMatch': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const sourceId = req.query['sourceId'];
                    const sourceType = req.query['sourceType'];
                    const targetId = req.query['targetId'];
                    const targetType = req.query['targetType'];
                    const personMatchManager = container.personMatchManager;
                    assertIsValid(personMatchManager);
                    const json = await personMatchManager.personMatchAsync({
                        sourceType,
                        sourceId,
                        targetType,
                        targetId
                    });
                    return res.json(json);
                }

                default: {
                    const filePath = __dirname + '/../views/admin/pages/index';
                    return res.render(filePath, {});
                }
            }
        } else {
            return res.status(403).json({
                message: `Missing scopes for admin/*.read in ${scope}`
            });
        }
    } catch (e) {
        const operationOutcome = new OperationOutcome({
            issue: [
                new OperationOutcomeIssue(
                    {
                        severity: 'error',
                        code: 'exception',
                        diagnostics: e.message
                    }
                )
            ]
        });
        return res.json(operationOutcome.toJSON());
    }
}

module.exports = {
    handleAdmin
};

