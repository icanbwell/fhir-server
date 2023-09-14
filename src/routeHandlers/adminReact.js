const {shouldReturnHtml} = require('../utils/requestHelpers');
const path = require('path');
const {assertTypeEquals} = require('../utils/assertType');
const {ConfigManager} = require('../utils/configManager');

/**
 * Handles admin routes via React UI
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 */
async function handleAdminReact(
    fnGetContainer,
    req,
    res,
    next
) {
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
    const scope = scopesManager.getScopeFromRequest({req});
    /**
     * @type {string[]}
     */
    const adminScopes = scopesManager.getAdminScopes({scope});
    // noinspection JSUnresolvedReference
    /**
     * @type {ConfigManager}
     */
    const configManager = container.configManager;
    assertTypeEquals(configManager, ConfigManager);

    if (!configManager.authEnabled || adminScopes.length > 0) {
        if (shouldReturnHtml(req)) {
            if (!configManager.disableNewUI && ((req.cookies && req.cookies['web2']) || configManager.showNewUI)) {
                const path1 = path.join(__dirname, '../web/build', 'index.html');
                console.log(`Route: /runPersonMatch/*: ${path1}`);
                // console.log(`Received /web/* ${req.method} request at ${req.url}`);
                return res.sendFile(path1);
            }
        }
    }
    return next();
}

module.exports = {
    handleAdminReact
};
