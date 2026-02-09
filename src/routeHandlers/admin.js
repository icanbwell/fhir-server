/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */
const httpContext = require('express-http-context');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const { AdminLogManager } = require('../admin/adminLogManager');
const { FhirResponseStreamer } = require('../utils/fhirResponseStreamer');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { assertIsValid } = require('../utils/assertType');
const { generateUUID } = require('../utils/uid.util');
const { logInfo } = require('../operations/common/logging');
const { REQUEST_ID_HEADER, REGEX } = require('../constants');
const { AdminExportManager } = require('../admin/adminExportManager');
const { logError } = require('../operations/common/logging');

/**
 * shows indexes
 * @param {import('http').IncomingMessage} req
 * @param {SimpleContainer} container
 * @param {import('express').Response} res
 * @param {boolean|undefined} [filterToProblems]
 * @returns {Promise<*>}
 */
async function showIndexesAsync ({
    req,
    res,
    container,
    filterToProblems
}) {
    logInfo('showIndexesAsync', { 'req.query': req.query });
    const audit = req.query.audit;
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;
    const json = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync(
        {
            audit: !!audit,
            filterToProblems
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
async function synchronizeIndexesAsync ({
    req,
    container,
    res
}) {
    logInfo('synchronizeIndexesAsync', { 'req.query': req.query });
    const audit = req.query.audit;
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;

    res.json({ message: 'Synchronization process triggered' });
    await indexManager.synchronizeIndexesWithConfigAsync({
        audit
    });
}

/**
 * Handles admin GET routes
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdminGet (
    fnGetContainer,
    req,
    res
) {
    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const operation = req.params.op;
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
         * @type {AdminExportManager}
         */
        const adminExportManager = container.adminExportManager;
        /**
        /**
         * @type {string|undefined}
         */
        const scope = scopesManager.getScopeFromRequest({ req });
        /**
         * @type {string[]}
         */
        const adminScopes = scopesManager.getAdminScopes({ scope });

        if (adminScopes.length > 0) {
            switch (operation) {
                case 'searchLogResults': {
                    logInfo('', { 'req.query': req.query });
                    const id = req.query.id;
                    if (id) {
                        // Validate that id is a string, not an object
                        if (typeof id !== 'string' || REGEX.ID_FIELD.test(id) === false) {
                            return res.status(400).json({
                                message: 'Invalid id parameter'
                            });
                        }
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
                    const bwellPersonId = req.query.bwellPersonId;
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

                case 'indexes': {
                    return await showIndexesAsync(
                        {
                            req,
                            container,
                            res,
                            filterToProblems: false
                        }
                    );
                }

                case 'indexProblems': {
                    return await showIndexesAsync(
                        {
                            req,
                            container,
                            res,
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
                    const sourceId = req.query.sourceId;
                    const sourceType = req.query.sourceType;
                    const targetId = req.query.targetId;
                    const targetType = req.query.targetType;
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

                case 'ExportStatus': {
                    logInfo('', { 'req.query': req.query, 'req.params.id': req.params.id });
                    return res.json(await adminExportManager.getExportStatus({ req, res }))
                }

                case 'getCacheKeys': {
                    const resourceType = req.query.resourceType;
                    const resourceId = req.query.resourceId;
                    if (resourceType && resourceId) {
                        const fhirCacheKeyManager = container.fhirCacheKeyManager;
                        try {
                            const result = await fhirCacheKeyManager.getAllKeysForResource({
                                resourceType,
                                resourceId
                            });
                            return res.json(result);
                        } catch (error) {
                            logError(`Error retrieving cache for ${resourceType}/${resourceId}`, error);
                            const operationOutcome = new OperationOutcome({
                                issue: [
                                    new OperationOutcomeIssue(
                                        {
                                            severity: 'error',
                                            code: 'exception',
                                            diagnostics: error.message
                                        }
                                    )
                                ]
                            });
                            return res.status(error.statusCode || 500).json(operationOutcome);
                        }
                    }
                    return res.json({
                        message: `No resourceId: ${resourceId} or resourceType: ${resourceType} passed`
                    });
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
    } catch (error) {
        logError(`Error in handleAdminGet`, {
            message: error.message,
            stack: error.stack,
            source: 'handleAdminGet'
        });
        const operationOutcome = new OperationOutcome({
            issue: [
                new OperationOutcomeIssue(
                    {
                        severity: 'error',
                        code: 'exception',
                        diagnostics: error.message
                    }
                )
            ]
        });
        return res.end(JSON.stringify(operationOutcome));
    }
}

/**
 * Handles admin POST routes
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdminPost (
    fnGetContainer,
    req,
    res
) {
    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const operation = req.params.op;
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
         * @type {AdminExportManager}
         */
        const adminExportManager = container.adminExportManager;
        /**
         * @type {string|undefined}
         */
        const scope = scopesManager.getScopeFromRequest({ req });
        /**
         * @type {string[]}
         */
        const adminScopes = scopesManager.getAdminScopes({ scope });

        if (adminScopes.length > 0) {
            switch (operation) {
                case 'createPersonToPersonLink': {
                    logInfo('', { 'req.body': req.body });
                    const bwellPersonId = req.body.bwellPersonId;
                    const externalPersonId = req.body.externalPersonId;
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPersonLinkAsync({
                            req,
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
                    logInfo('', { 'req.body': req.body });
                    const bwellPersonId = req.body.bwellPersonId;
                    const externalPersonId = req.body.externalPersonId;
                    if (bwellPersonId && externalPersonId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.removePersonToPersonLinkAsync({
                            req,
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
                    logInfo('', { 'req.body': req.body });
                    const externalPersonId = req.body.externalPersonId;
                    const patientId = req.body.patientId;
                    if (patientId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.createPersonToPatientLinkAsync({
                            req,
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
                    logInfo('', { 'req.body': req.body });
                    const personId = req.body.personId;
                    const patientId = req.body.patientId;
                    if (personId && patientId) {
                        /**
                         * @type {import('../admin/adminPersonPatientLinkManager').AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.removePersonToPatientLinkAsync({
                            req,
                            personId,
                            patientId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No personId: ${personId} or patientId: ${patientId} passed`
                    });
                }

                case 'updatePatientReference': {
                    logInfo('', { 'req.body': req.body });
                    const patientId = req.body.patientId;
                    const resourceType = req.body.resourceType;
                    const resourceId = req.body.resourceId;
                    if (resourceId && resourceType && patientId) {
                        /**
                         * @type {import('../admin/adminPersonPatientLinkManager').AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.updatePatientLinkAsync({
                            req,
                            resourceType,
                            resourceId,
                            patientId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No resourceId: ${resourceId} or resourceType: ${resourceType} or patientId: ${patientId} passed`
                    });
                }
                case 'triggerExport': {
                    if (req.params.id) {
                        return res.json(await adminExportManager.triggerExportJob({ req, res }));
                    }
                    else {
                        return res.status(400).json({ message: 'ExportStatusId was not passed' });
                    }
                }
                case 'invalidateCache': {
                    const resourceType = req.body.resourceType;
                    const resourceId = req.body.resourceId;
                    const cacheKeys = req.body.cacheKeys;
                    const fhirCacheKeyManager = container.fhirCacheKeyManager;
                    try {
                        if (resourceType && resourceId) {
                            await fhirCacheKeyManager.invalidateCacheKeysForResource({
                                resourceType,
                                resourceId
                            });
                            return res.json({ message: `Cache invalidated for ${resourceType}/${resourceId}` });
                        }
                        else if (cacheKeys && Array.isArray(cacheKeys) && cacheKeys.length > 0) {
                            await fhirCacheKeyManager.invalidateCacheKeys({ cacheKeys });
                            return res.json({ message: `Cache invalidated successfully` });
                        }
                        else {
                            return res.status(400).json({
                                message: `Either cacheKeys or resourceType and resourceId must be provided`
                            });
                        }
                    } catch (error) {
                        logError(`Error invalidating cache`, error);
                        const operationOutcome = new OperationOutcome({
                            issue: [
                                new OperationOutcomeIssue(
                                    {
                                        severity: 'error',
                                        code: 'exception',
                                        diagnostics: error.message
                                    }
                                )
                            ]
                        });
                        return res.status(error.statusCode || 500).json(operationOutcome);
                    }
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
    } catch (error) {
        logError(`Error in handleAdminPost`, {
            message: error.message,
            stack: error.stack,
            source: 'handleAdminPost'
        });
        const operationOutcome = new OperationOutcome({
            issue: [
                new OperationOutcomeIssue(
                    {
                        severity: 'error',
                        code: 'exception',
                        diagnostics: error.message
                    }
                )
            ]
        });
        return res.status(error.statusCode || 500).json(operationOutcome);
    }
}

/**
 * Handles admin put routes
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdminPut(
    fnGetContainer,
    req,
    res
) {
    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const operation = req.params.op;
        logInfo(`op=${operation}`, {});
        // set up all the standard services in the container
        /**
         * @type {SimpleContainer}
         */
        const container = fnGetContainer();
        /**
         * @type {AdminExportManager}
         */
        const adminExportManager = container.adminExportManager;
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

        if (adminScopes.length > 0) {
            switch (operation) {
                case 'ExportStatus': {
                    logInfo('', { 'req.query': req.query, 'req.param.id': req.params.id });
                    if (req.params.id) {
                        return res.json(await adminExportManager.updateExportStatus({ req, res }));
                    }
                    else {
                        return res.status(400).json({ message: 'ExportStatusId was not passed' })
                    }
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
    }
    catch (error) {
        logError(`Error in handleAdminPut`, {
            message: error.message,
            stack: error.stack,
            source: 'handleAdminPut'
        });
        const operationOutcome = new OperationOutcome({
            issue: [
                new OperationOutcomeIssue(
                    {
                        severity: 'error',
                        code: 'exception',
                        diagnostics: error.message
                    }
                )
            ]
        });

        return res.status(error.statusCode || 500).json(operationOutcome);

    }
}

/**
 * Handles admin delete routes
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdminDelete (
    fnGetContainer,
    req,
    res
) {
    try {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const operation = req.params.op;
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

        if (adminScopes.length > 0) {
            switch (operation) {
                case 'deletePerson': {
                    logInfo('', { 'req.query': req.query });
                    const personId = req.query.personId;
                    if (personId) {
                        /**
                         * @type {AdminPersonPatientLinkManager}
                         */
                        const adminPersonPatientLinkManager = container.adminPersonPatientLinkManager;
                        const json = await adminPersonPatientLinkManager.deletePersonAsync({
                            req,
                            requestId: req.id,
                            personId
                        });
                        return res.json(json);
                    }
                    return res.json({
                        message: `No personId: ${personId} passed`
                    });
                }

                case 'deletePatientDataGraph': {
                    logInfo('', { 'req.query': req.query });
                    const patientId = req.query.id;
                    const sync = req.query.sync;
                    if (patientId) {
                        /**
                         * @type {string[]}
                         */
                        const scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';

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
                    const personId = req.query.id;
                    if (personId) {
                        /**
                         * @type {string[]}
                         */
                        const scopes = scopesManager.parseScopes(scope);
                        const resourceType = 'Patient';
                        const accessRequested = 'write';

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

                default: {
                    return res.json({ message: 'Invalid Path' });
                }
            }
        } else {
            return res.status(403).json({
                message: `Missing scopes for admin/*.read in ${scope}`
            });
        }
    } catch (error) {
        logError(`Error in handleAdminDelete`, {
            message: error.message,
            stack: error.stack,
            source: 'handleAdminDelete'
        });
        const operationOutcome = new OperationOutcome({
            issue: [
                new OperationOutcomeIssue(
                    {
                        severity: 'error',
                        code: 'exception',
                        diagnostics: error.message
                    }
                )
            ]
        });
        return res.end(JSON.stringify(operationOutcome));
    }
}

module.exports = {
    handleAdminGet,
    handleAdminPost,
    handleAdminDelete,
    handleAdminPut
};
