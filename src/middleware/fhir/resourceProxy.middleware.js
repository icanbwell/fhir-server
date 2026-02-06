/**
 * Middleware to proxy requests to resource-specific backend services
 * This enables a microservices architecture where authentication/authorization is centralized
 * but resource handling can be distributed across multiple services
 */
const axios = require('axios');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {logInfo, logError} = require('../../operations/common/logging');

/**
 * Creates a middleware that proxies requests to backend services based on resource type
 * @param {ConfigManager} configManager
 * @returns {function}
 */
function createResourceProxyMiddleware(configManager) {
    assertTypeEquals(configManager, ConfigManager);

    // Map of resource types to their backend service URLs
    // Read from environment variables
    const serviceMapping = {};
    
    if (configManager.observationServiceUrl) {
        serviceMapping['Observation'] = configManager.observationServiceUrl;
    }
    
    if (configManager.patientServiceUrl) {
        serviceMapping['Patient'] = configManager.patientServiceUrl;
    }

    // Add more resource mappings based on environment variables
    // Example: DEVICE_SERVICE_URL, MEDICATION_SERVICE_URL, etc.

    return async (req, res, next) => {
        try {
            // Extract resource type from the request path
            // Assumes path format: /4_0_0/ResourceType/... or /4_0_0/ResourceType
            const pathParts = req.path.split('/').filter(p => p);
            
            if (pathParts.length < 2) {
                // Not a resource request, continue normally
                return next();
            }

            const resourceType = pathParts[1];

            // Check if this resource should be proxied to a backend service
            const backendServiceUrl = serviceMapping[resourceType];
            
            if (!backendServiceUrl) {
                // No backend service configured for this resource, handle locally
                return next();
            }

            logInfo('Proxying request to backend service', {
                resourceType,
                backendServiceUrl,
                method: req.method,
                path: req.path,
                user: req.user?.username || 'anonymous'
            });

            // Extract user context from the authenticated request
            const userScopes = req.user?.scope || [];
            const accessCodes = req.user?.access || [];
            const clientFhirPersonId = req.user?.clientFhirPersonId;
            const bwellFhirPersonId = req.user?.bwellFhirPersonId;

            // Forward the authenticated request to the backend service
            // Include the original JWT token and parsed user context
            const response = await axios({
                method: req.method,
                url: `${backendServiceUrl}${req.path}`,
                params: req.query,
                data: req.body,
                headers: {
                    'Authorization': req.headers.authorization,
                    'Content-Type': req.headers['content-type'] || 'application/fhir+json',
                    'Accept': req.headers.accept || 'application/fhir+json',
                    // Pass parsed user context to backend service
                    'X-User-Scopes': JSON.stringify(userScopes),
                    'X-Access-Codes': JSON.stringify(accessCodes),
                    'X-Client-Person-Id': clientFhirPersonId || '',
                    'X-Bwell-Person-Id': bwellFhirPersonId || '',
                    'X-Request-Id': req.id || '',
                    // Include internal service secret if configured
                    ...(configManager.internalServiceSecret && {
                        'X-Internal-Secret': configManager.internalServiceSecret
                    })
                },
                // Follow redirects
                maxRedirects: 5,
                // Timeout after 30 seconds
                timeout: 30000,
                // Don't throw on error status codes
                validateStatus: () => true
            });

            logInfo('Received response from backend service', {
                resourceType,
                backendServiceUrl,
                status: response.status,
                user: req.user?.username || 'anonymous'
            });

            // Forward the response from the backend service
            // Copy relevant headers
            const headersToForward = [
                'content-type',
                'etag',
                'last-modified',
                'location',
                'cache-control'
            ];

            headersToForward.forEach(header => {
                if (response.headers[header]) {
                    res.setHeader(header, response.headers[header]);
                }
            });

            // Return the response
            res.status(response.status).send(response.data);

        } catch (error) {
            if (error.response) {
                // Backend service returned an error
                logError('Backend service returned error', {
                    error: error.message,
                    status: error.response.status,
                    data: error.response.data,
                    user: req.user?.username || 'anonymous'
                });
                
                res.status(error.response.status).send(error.response.data);
            } else if (error.code === 'ECONNREFUSED') {
                // Backend service is not available
                logError('Backend service unavailable', {
                    error: error.message,
                    user: req.user?.username || 'anonymous'
                });
                
                res.status(503).send({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'timeout',
                        diagnostics: 'Backend service is unavailable. Please try again later.'
                    }]
                });
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                // Request timeout
                logError('Backend service timeout', {
                    error: error.message,
                    user: req.user?.username || 'anonymous'
                });
                
                res.status(504).send({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'timeout',
                        diagnostics: 'Backend service request timed out. Please try again.'
                    }]
                });
            } else {
                // Network or other error
                logError('Error proxying to backend service', {
                    error: error.message,
                    stack: error.stack,
                    user: req.user?.username || 'anonymous'
                });
                
                res.status(502).send({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'exception',
                        diagnostics: 'Error communicating with backend service'
                    }]
                });
            }
        }
    };
}

module.exports = {
    createResourceProxyMiddleware
};
