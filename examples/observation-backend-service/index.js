/**
 * Example Backend Service for FHIR Observation Resources
 * 
 * This service demonstrates how to create a microservice that:
 * 1. Receives authenticated requests from the main FHIR server
 * 2. Validates internal service authentication
 * 3. Respects user authorization (scopes and access codes)
 * 4. Implements FHIR Observation CRUD operations
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const {MongoClient} = require('mongodb');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// Initialize Express app
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

// MongoDB connection
const mongoUrl = process.env.MONGO_URL || 'mongodb://mongo:27017/fhir';
const dbName = process.env.MONGO_DB_NAME || 'fhir';
let db;

MongoClient.connect(mongoUrl, {useUnifiedTopology: true})
    .then(client => {
        db = client.db(dbName);
        logger.info('Connected to MongoDB', {database: dbName});
    })
    .catch(err => {
        logger.error('Failed to connect to MongoDB', {error: err.message});
        process.exit(1);
    });

/**
 * Middleware to validate internal service authentication
 */
app.use((req, res, next) => {
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    
    if (internalSecret) {
        const providedSecret = req.headers['x-internal-secret'];
        
        if (providedSecret !== internalSecret) {
            logger.warn('Invalid internal service secret', {
                ip: req.ip,
                path: req.path
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Invalid internal service credentials'
                }]
            });
        }
    }
    
    next();
});

/**
 * Middleware to extract and validate user context from headers
 */
app.use((req, res, next) => {
    try {
        // Extract user context passed from main FHIR server
        req.userScopes = JSON.parse(req.headers['x-user-scopes'] || '[]');
        req.accessCodes = JSON.parse(req.headers['x-access-codes'] || '[]');
        req.clientFhirPersonId = req.headers['x-client-person-id'] || null;
        req.bwellFhirPersonId = req.headers['x-bwell-person-id'] || null;
        req.requestId = req.headers['x-request-id'] || null;
        
        logger.info('Request received', {
            method: req.method,
            path: req.path,
            requestId: req.requestId,
            hasScopes: req.userScopes.length > 0,
            hasAccessCodes: req.accessCodes.length > 0
        });
        
        next();
    } catch (error) {
        logger.error('Invalid user context headers', {error: error.message});
        res.status(400).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'invalid',
                diagnostics: 'Invalid user context headers'
            }]
        });
    }
});

/**
 * Helper function to check if user has access to a resource
 */
function hasAccess(resource, req) {
    // If no access codes are provided, deny access (unless this is a test environment)
    if (process.env.NODE_ENV !== 'test' && req.accessCodes.length === 0) {
        return false;
    }
    
    // Check if resource has security tags that match user's access codes
    const securityTags = resource.meta?.security || [];
    const hasAccessTag = securityTags.some(
        tag => tag.system === 'https://www.icanbwell.com/access' 
            && req.accessCodes.includes(tag.code)
    );
    
    return hasAccessTag || process.env.NODE_ENV === 'test';
}

/**
 * Helper function to check if user has required scope
 */
function hasScope(req, resourceType, operation) {
    const requiredScope = `user/${resourceType}.${operation}`;
    const wildcardScope = `user/*.${operation}`;
    const fullWildcardScope = 'user/*.*';
    
    return req.userScopes.includes(requiredScope) ||
           req.userScopes.includes(wildcardScope) ||
           req.userScopes.includes(fullWildcardScope);
}

/**
 * Build MongoDB query based on FHIR search parameters
 */
function buildSearchQuery(queryParams, req) {
    const query = {};
    
    // Subject parameter
    if (queryParams.subject) {
        query['subject.reference'] = queryParams.subject;
    }
    
    // Code parameter
    if (queryParams.code) {
        query['code.coding.code'] = queryParams.code;
    }
    
    // Category parameter
    if (queryParams.category) {
        query['category.coding.code'] = queryParams.category;
    }
    
    // Date parameter (supports various formats)
    if (queryParams.date) {
        // Simple implementation - can be enhanced for ranges
        query['effectiveDateTime'] = queryParams.date;
    }
    
    // Status parameter
    if (queryParams.status) {
        query['status'] = queryParams.status;
    }
    
    // Apply access control based on security tags
    if (req.accessCodes.length > 0) {
        query['meta.security'] = {
            $elemMatch: {
                'system': 'https://www.icanbwell.com/access',
                'code': {$in: req.accessCodes}
            }
        };
    }
    
    return query;
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        service: 'observation-service',
        timestamp: new Date().toISOString(),
        mongodb: db ? 'connected' : 'disconnected'
    };
    
    res.json(health);
});

/**
 * Search Observations
 * GET /4_0_0/Observation?subject=Patient/123&code=xyz
 */
app.get('/4_0_0/Observation', async (req, res) => {
    try {
        // Check authorization
        if (!hasScope(req, 'Observation', 'read') && !hasScope(req, 'Observation', '*')) {
            logger.warn('Insufficient scope for Observation search', {
                requestId: req.requestId,
                scopes: req.userScopes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Insufficient permissions to read Observation resources'
                }]
            });
        }
        
        const {_count = 10, _getpagesoffset = 0} = req.query;
        
        // Build query based on search parameters
        const query = buildSearchQuery(req.query, req);
        
        logger.info('Searching Observations', {
            requestId: req.requestId,
            query: JSON.stringify(query),
            count: _count,
            offset: _getpagesoffset
        });
        
        // Fetch observations from database
        const observations = await db.collection('Observation_4_0_0')
            .find(query)
            .limit(parseInt(_count))
            .skip(parseInt(_getpagesoffset))
            .toArray();
        
        const total = await db.collection('Observation_4_0_0')
            .countDocuments(query);
        
        logger.info('Search completed', {
            requestId: req.requestId,
            resultsFound: observations.length,
            total: total
        });
        
        // Return FHIR Bundle
        const bundle = {
            resourceType: 'Bundle',
            type: 'searchset',
            total: total,
            entry: observations.map(obs => ({
                resource: obs,
                fullUrl: `${req.protocol}://${req.get('host')}/4_0_0/Observation/${obs.id}`
            }))
        };
        
        res.json(bundle);
        
    } catch (error) {
        logger.error('Error searching observations', {
            error: error.message,
            stack: error.stack,
            requestId: req.requestId
        });
        
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

/**
 * Read Observation by ID
 * GET /4_0_0/Observation/123
 */
app.get('/4_0_0/Observation/:id', async (req, res) => {
    try {
        // Check authorization
        if (!hasScope(req, 'Observation', 'read') && !hasScope(req, 'Observation', '*')) {
            logger.warn('Insufficient scope for Observation read', {
                requestId: req.requestId,
                scopes: req.userScopes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Insufficient permissions to read Observation resources'
                }]
            });
        }
        
        logger.info('Reading Observation', {
            requestId: req.requestId,
            id: req.params.id
        });
        
        const observation = await db.collection('Observation_4_0_0')
            .findOne({id: req.params.id});
        
        if (!observation) {
            logger.info('Observation not found', {
                requestId: req.requestId,
                id: req.params.id
            });
            
            return res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Observation/${req.params.id} not found`
                }]
            });
        }
        
        // Check access control
        if (!hasAccess(observation, req)) {
            logger.warn('Access denied to Observation', {
                requestId: req.requestId,
                id: req.params.id,
                accessCodes: req.accessCodes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Access denied to this resource'
                }]
            });
        }
        
        logger.info('Observation found', {
            requestId: req.requestId,
            id: req.params.id
        });
        
        res.json(observation);
        
    } catch (error) {
        logger.error('Error reading observation', {
            error: error.message,
            stack: error.stack,
            requestId: req.requestId,
            id: req.params.id
        });
        
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

/**
 * Create Observation
 * POST /4_0_0/Observation
 */
app.post('/4_0_0/Observation', async (req, res) => {
    try {
        // Check authorization
        if (!hasScope(req, 'Observation', 'write') && !hasScope(req, 'Observation', '*')) {
            logger.warn('Insufficient scope for Observation create', {
                requestId: req.requestId,
                scopes: req.userScopes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Insufficient permissions to create Observation resources'
                }]
            });
        }
        
        const observation = req.body;
        
        logger.info('Creating Observation', {
            requestId: req.requestId,
            id: observation.id
        });
        
        // Add metadata
        observation.meta = observation.meta || {};
        observation.meta.versionId = '1';
        observation.meta.lastUpdated = new Date().toISOString();
        
        // Insert into database
        await db.collection('Observation_4_0_0').insertOne(observation);
        
        logger.info('Observation created', {
            requestId: req.requestId,
            id: observation.id
        });
        
        res.status(201)
           .location(`/4_0_0/Observation/${observation.id}`)
           .json(observation);
        
    } catch (error) {
        logger.error('Error creating observation', {
            error: error.message,
            stack: error.stack,
            requestId: req.requestId
        });
        
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

/**
 * Update Observation
 * PUT /4_0_0/Observation/123
 */
app.put('/4_0_0/Observation/:id', async (req, res) => {
    try {
        // Check authorization
        if (!hasScope(req, 'Observation', 'write') && !hasScope(req, 'Observation', '*')) {
            logger.warn('Insufficient scope for Observation update', {
                requestId: req.requestId,
                scopes: req.userScopes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Insufficient permissions to update Observation resources'
                }]
            });
        }
        
        const observation = req.body;
        observation.id = req.params.id;
        
        logger.info('Updating Observation', {
            requestId: req.requestId,
            id: observation.id
        });
        
        // Check if resource exists and user has access
        const existing = await db.collection('Observation_4_0_0')
            .findOne({id: req.params.id});
        
        if (existing && !hasAccess(existing, req)) {
            logger.warn('Access denied for Observation update', {
                requestId: req.requestId,
                id: req.params.id,
                accessCodes: req.accessCodes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Access denied to update this resource'
                }]
            });
        }
        
        // Update metadata
        observation.meta = observation.meta || {};
        const currentVersion = parseInt(existing?.meta?.versionId || '0');
        observation.meta.versionId = String(currentVersion + 1);
        observation.meta.lastUpdated = new Date().toISOString();
        
        // Update in database
        await db.collection('Observation_4_0_0').replaceOne(
            {id: req.params.id},
            observation,
            {upsert: true}
        );
        
        logger.info('Observation updated', {
            requestId: req.requestId,
            id: observation.id,
            versionId: observation.meta.versionId
        });
        
        res.status(200).json(observation);
        
    } catch (error) {
        logger.error('Error updating observation', {
            error: error.message,
            stack: error.stack,
            requestId: req.requestId,
            id: req.params.id
        });
        
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

/**
 * Delete Observation
 * DELETE /4_0_0/Observation/123
 */
app.delete('/4_0_0/Observation/:id', async (req, res) => {
    try {
        // Check authorization
        if (!hasScope(req, 'Observation', 'write') && !hasScope(req, 'Observation', '*')) {
            logger.warn('Insufficient scope for Observation delete', {
                requestId: req.requestId,
                scopes: req.userScopes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Insufficient permissions to delete Observation resources'
                }]
            });
        }
        
        logger.info('Deleting Observation', {
            requestId: req.requestId,
            id: req.params.id
        });
        
        // Check if resource exists and user has access
        const existing = await db.collection('Observation_4_0_0')
            .findOne({id: req.params.id});
        
        if (!existing) {
            return res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Observation/${req.params.id} not found`
                }]
            });
        }
        
        if (!hasAccess(existing, req)) {
            logger.warn('Access denied for Observation delete', {
                requestId: req.requestId,
                id: req.params.id,
                accessCodes: req.accessCodes
            });
            
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    diagnostics: 'Access denied to delete this resource'
                }]
            });
        }
        
        // Delete from database
        await db.collection('Observation_4_0_0').deleteOne({id: req.params.id});
        
        logger.info('Observation deleted', {
            requestId: req.requestId,
            id: req.params.id
        });
        
        res.status(204).send();
        
    } catch (error) {
        logger.error('Error deleting observation', {
            error: error.message,
            stack: error.stack,
            requestId: req.requestId,
            id: req.params.id
        });
        
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        requestId: req.requestId
    });
    
    res.status(500).json({
        resourceType: 'OperationOutcome',
        issue: [{
            severity: 'error',
            code: 'exception',
            diagnostics: 'An unexpected error occurred'
        }]
    });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info('Observation backend service started', {
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development'
    });
});
