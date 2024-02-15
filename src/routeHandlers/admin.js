/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */
const { AdminLogManager } = require('../admin/adminLogManager');
const env = require('var');
const { isTrue } = require('../utils/isTrue');
const { assertIsValid } = require('../utils/assertType');
const { FhirResponseStreamer } = require('../utils/fhirResponseStreamer');
const { generateUUID } = require('../utils/uid.util');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { REQUEST_ID_HEADER } = require('../constants');
const { logInfo } = require('../operations/common/logging');
const httpContext = require('express-http-context');

/**
 * shows indexes
 * @param {import('http').IncomingMessage} req
 * @param {SimpleContainer} container
 * @param {import('express').Response} res
 * @param {boolean|undefined} [filterToProblems]
 * @returns {Promise<*>}
 */
async function showIndexesAsync (
    {
        req, container, res,
        filterToProblems
    }) {
    logInfo('showIndexesAsync', { 'req.query': req.query });
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
    return res.json(json);
}

/**
 * synchronizes indexes
 * @param {import('express').Request} req
 * @param {SimpleContainer} container
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function synchronizeIndexesAsync (
    {
        req,
        container,
        res
    }
) {
    logInfo('synchronizeIndexesAsync', { 'req.query': req.query });
    const audit = req.query['audit'];
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;

    res.json({ message: 'Synchronization process triggered' });
    await indexManager.synchronizeIndexesWithConfigAsync({
        audit: audit
    });
}

/**
 * Handles admin routes
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdmin (
    fnGetContainer,
    req,
    res
) {
    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const operation = req.params['op'];
        logInfo(`op=${operation}`, {});

        // set up all the standard services in the container
        /**
         * @type {SimpleContainer}
         */
        const container = fnGetContainer();
        /**
         * @type {ScopesManager}
         */
        const scopesManager = container.scopesManager;
        /**
         * @type {string|undefined}
         */
        const scope = scopesManager.getScopeFromRequest({ req });
        /**
         * @type {string[]}
         */
        const adminScopes = scopesManager.getAdminScopes({ scope });

        if (!isTrue(env.AUTH_ENABLED) || adminScopes.length > 0) {
            switch (operation) {
                case 'searchLogResults': {
                    logInfo('', { 'req.query': req.query });
                    const id = req.query['id'];
                    if (id) {
                        const adminLogManager = new AdminLogManager({ mongoDatabaseManager: container.mongoDatabaseManager });
                        const json = await adminLogManager.getLogAsync(id);
                        return res.json(json);
                    }
                    return res.json({
                        message: 'No id passed'
                    });
                }

                case 'showPersonToPersonLink': {
                    logInfo('', { 'req.query': req.query });
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
                    logInfo('', { 'req.query': req.query });
                    const personId = req.query['personId'];
                    if (personId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.deletePersonAsync({
                            req: req,
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
                    logInfo('', { 'req.query': req.query });
                    const bwellPersonId = req.query['bwellPersonId'];
                    const externalPersonId = req.query['externalPersonId'];
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPersonLinkAsync({
                            req: req,
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
                    logInfo('', { 'req.query': req.query });
                    const bwellPersonId = req.query['bwellPersonId'];
                    const externalPersonId = req.query['externalPersonId'];
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.removePersonToPersonLinkAsync({
                            req: req,
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
                    logInfo('', { 'req.query': req.query });
                    const externalPersonId = req.query['externalPersonId'];
                    const patientId = req.query['patientId'];
                    if (patientId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPatientLinkAsync({
                            req: req,
                            externalPersonId,
                            patientId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No patientId: ${patientId} passed`
                    });
                }

                case 'removePersonToPatientLink': {
                    logInfo('', { 'req.query': req.query });
                    const personId = req.query['personId'];
                    const patientId = req.query['patientId'];
                    if (personId && patientId) {
                        /**
                         * @type {import('../admin/adminPersonPatientLinkManager').AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.removePersonToPatientLinkAsync({
                            req: req,
                            personId,
                            patientId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No personId: ${personId} or patientId: ${patientId} passed`
                    });
                }

                case 'deletePatientDataGraph': {
                    logInfo('', { 'req.query': req.query });
                    const patientId = req.query['id'];
                    const sync = req.query['sync'];
                    if (patientId) {
                        /**
                         * @type {string[]}
                         */
                        const scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';
                        // eslint-disable-next-line no-unused-vars
                        const { success } = scopeChecker(resourceType, accessRequested, scopes);
                        if (!success) {
                            const errorMessage = 'user with scopes [' + scopes +
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
                             * @type {FhirResponseStreamer}
                             */
                            const responseStreamer = new FhirResponseStreamer({
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
                    logInfo('', { 'req.query': req.query });
                    const personId = req.query['id'];
                    if (personId) {
                        /**
                         * @type {string[]}
                         */
                        const scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';
                        // eslint-disable-next-line no-unused-vars
                        const { success } = scopeChecker(resourceType, accessRequested, scopes);
                        if (!success) {
                            const errorMessage = 'user with scopes [' + scopes +
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
                         * @type {FhirResponseStreamer}
                         */
                        const responseStreamer = new FhirResponseStreamer({
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
                    logInfo('', { 'req.query': req.query });
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
                    return res.json({ message: 'Invalid Path' });
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
        return res.end(JSON.stringify(operationOutcome));
    }
}

module.exports = {
    handleAdmin
};
