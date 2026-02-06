# Microservices Architecture with Centralized Authentication

## Overview

This guide explains how to set up a microservices architecture where:
1. **Main FHIR Server** - Handles authentication, authorization, and routing
2. **Resource-Specific Backend Services** - Handle specific FHIR resources (e.g., Observation for devices)

## Architecture Diagram

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│   Main FHIR Server (Auth Gateway)   │
│  - Authentication & Authorization    │
│  - Token Validation                  │
│  - Request Routing                   │
└──────┬───────────────────────────────┘
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌─────────────┐   ┌──────────────┐   ┌──────────────┐
│  Patient    │   │ Observation  │   │   Other      │
│  Service    │   │   Service    │   │  Resources   │
│             │   │  (Devices)   │   │              │
└─────────────┘   └──────────────┘   └──────────────┘
```

## Approach 1: API Gateway Pattern with Proxy

### Main FHIR Server Configuration

The main FHIR server acts as an API gateway that:
- Authenticates and validates JWT tokens
- Authorizes requests based on scopes
- Proxies specific resource requests to backend services

#### 1. Configure Environment Variables

In your main FHIR server, set up the following environment variables:

```bash
# Main FHIR Server
AUTH_JWKS_URL=https://your-oauth-provider/.well-known/jwks.json
AUTH_CODE_FLOW_URL=https://your-oauth-provider/oauth2/authorize
AUTH_CODE_FLOW_CLIENT_ID=your-client-id
AUTH_CONFIGURATION_URI=https://your-oauth-provider/.well-known/openid-configuration

# Backend service URLs
OBSERVATION_SERVICE_URL=http://observation-service:3001
PATIENT_SERVICE_URL=http://patient-service:3002
```

#### 2. Create Proxy Middleware

Create a new file: `src/middleware/fhir/resourceProxy.middleware.js`

```javascript
const axios = require('axios');
const {ConfigManager} = require('../../utils/configManager');

/**
 * Middleware to proxy requests to resource-specific backend services
 * @param {ConfigManager} configManager
 * @returns {function}
 */
function createResourceProxyMiddleware(configManager) {
    const serviceMapping = {
        'Observation': configManager.observationServiceUrl,
        'Patient': configManager.patientServiceUrl,
        // Add more resource mappings as needed
    };

    return async (req, res, next) => {
        // Extract resource type from the request path
        const pathParts = req.path.split('/');
        const resourceType = pathParts[2]; // Assuming /4_0_0/Observation format

        // Check if this resource should be proxied to a backend service
        const backendServiceUrl = serviceMapping[resourceType];
        
        if (!backendServiceUrl) {
            // No backend service configured, handle locally
            return next();
        }

        try {
            // Forward the authenticated request to the backend service
            // Include the original JWT token for backend validation if needed
            const response = await axios({
                method: req.method,
                url: `${backendServiceUrl}${req.path}`,
                params: req.query,
                data: req.body,
                headers: {
                    'Authorization': req.headers.authorization,
                    'Content-Type': req.headers['content-type'],
                    'X-User-Scopes': JSON.stringify(req.user?.scope || []),
                    'X-Access-Codes': JSON.stringify(req.user?.access || [])
                }
            });

            // Return the response from the backend service
            res.status(response.status)
               .set(response.headers)
               .send(response.data);
               
        } catch (error) {
            if (error.response) {
                // Backend service returned an error
                res.status(error.response.status).send(error.response.data);
            } else {
                // Network or other error
                console.error('Error proxying to backend service:', error);
                res.status(502).send({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'exception',
                        diagnostics: 'Backend service unavailable'
                    }]
                });
            }
        }
    };
}

module.exports = {createResourceProxyMiddleware};
```

#### 3. Update Router Configuration

Modify `src/middleware/fhir/router.js` to include the proxy middleware:

```javascript
// Add this import at the top
const {createResourceProxyMiddleware} = require('./resourceProxy.middleware');

// In the router setup, add the proxy middleware before the regular routes
// This should be added in the configureRoute method or wherever routes are defined

// Example modification in the route configuration:
router.use(authenticationMiddleware(config));
router.use(sofScopeMiddleware(config));
router.use(createResourceProxyMiddleware(configManager)); // Add this line
// ... rest of the route configuration
```

### Backend Observation Service

The backend service should be a separate Node.js application that:
- Validates incoming requests
- Trusts the authentication from the main FHIR server
- Implements resource-specific business logic

#### 1. Create Backend Service

Create a new Node.js project for the Observation service:

```bash
mkdir observation-service
cd observation-service
npm init -y
npm install express mongodb cors
```

#### 2. Backend Service Implementation

Create `observation-service/index.js`:

```javascript
const express = require('express');
const cors = require('cors');
const {MongoClient} = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
const mongoUrl = process.env.MONGO_URL || 'mongodb://mongo:27017/fhir';
let db;

MongoClient.connect(mongoUrl, {useUnifiedTopology: true})
    .then(client => {
        db = client.db();
        console.log('Connected to MongoDB');
    });

// Middleware to extract user context from headers
app.use((req, res, next) => {
    try {
        req.userScopes = JSON.parse(req.headers['x-user-scopes'] || '[]');
        req.accessCodes = JSON.parse(req.headers['x-access-codes'] || '[]');
        next();
    } catch (error) {
        res.status(400).send({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'invalid',
                diagnostics: 'Invalid user context headers'
            }]
        });
    }
});

// Example Observation search endpoint
app.get('/4_0_0/Observation', async (req, res) => {
    try {
        const {subject, code, _count = 10, _getpagesoffset = 0} = req.query;
        
        // Build query based on FHIR search parameters
        const query = {};
        
        if (subject) {
            query['subject.reference'] = subject;
        }
        
        if (code) {
            query['code.coding.code'] = code;
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
        
        // Fetch observations from database
        const observations = await db.collection('Observation_4_0_0')
            .find(query)
            .limit(parseInt(_count))
            .skip(parseInt(_getpagesoffset))
            .toArray();
        
        const total = await db.collection('Observation_4_0_0')
            .countDocuments(query);
        
        // Return FHIR Bundle
        res.json({
            resourceType: 'Bundle',
            type: 'searchset',
            total: total,
            entry: observations.map(obs => ({
                resource: obs,
                fullUrl: `${req.protocol}://${req.get('host')}/${req.path}/${obs.id}`
            }))
        });
        
    } catch (error) {
        console.error('Error searching observations:', error);
        res.status(500).send({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

// Example Observation read endpoint
app.get('/4_0_0/Observation/:id', async (req, res) => {
    try {
        const observation = await db.collection('Observation_4_0_0')
            .findOne({id: req.params.id});
        
        if (!observation) {
            return res.status(404).send({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Observation/${req.params.id} not found`
                }]
            });
        }
        
        // Check access control
        if (req.accessCodes.length > 0) {
            const hasAccess = observation.meta?.security?.some(
                tag => tag.system === 'https://www.icanbwell.com/access' 
                    && req.accessCodes.includes(tag.code)
            );
            
            if (!hasAccess) {
                return res.status(403).send({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'forbidden',
                        diagnostics: 'Access denied'
                    }]
                });
            }
        }
        
        res.json(observation);
        
    } catch (error) {
        console.error('Error reading observation:', error);
        res.status(500).send({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Observation service listening on port ${PORT}`);
});
```

## Approach 2: Shared Authentication Library

Another approach is to create a shared authentication library that both services use:

### 1. Create Shared Auth Package

Create `shared-auth/package.json`:

```json
{
  "name": "@yourorg/fhir-auth",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "jwks-rsa": "^3.2.0"
  }
}
```

Create `shared-auth/index.js`:

```javascript
const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const jwksRsa = require('jwks-rsa');

class SharedAuthStrategy {
    constructor(authJwksUrl) {
        this.strategy = new JwtStrategy(
            {
                secretOrKeyProvider: jwksRsa.passportJwtSecret({
                    cache: true,
                    rateLimit: true,
                    jwksRequestsPerMinute: 5,
                    jwksUri: authJwksUrl
                }),
                jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
                passReqToCallback: true
            },
            this.verify.bind(this)
        );
    }

    verify(request, jwt_payload, done) {
        // Common verification logic
        const user = {
            username: jwt_payload.username,
            scope: jwt_payload.scope?.split(' ') || [],
            access: jwt_payload.access || [],
            clientFhirPersonId: jwt_payload.clientFhirPersonId
        };
        
        return done(null, user);
    }

    getStrategy() {
        return this.strategy;
    }
}

module.exports = {SharedAuthStrategy};
```

### 2. Use in Backend Services

In both the main server and backend services:

```javascript
const passport = require('passport');
const {SharedAuthStrategy} = require('@yourorg/fhir-auth');

const authStrategy = new SharedAuthStrategy(process.env.AUTH_JWKS_URL);
passport.use('jwt', authStrategy.getStrategy());

app.use(passport.initialize());
app.use(passport.authenticate('jwt', {session: false}));
```

## Deployment Configuration

### Docker Compose Example

Create `docker-compose-microservices.yml`:

```yaml
version: '3.8'

services:
  main-fhir-server:
    image: imranq2/node-fhir-server-mongo:latest
    ports:
      - "3000:3000"
    environment:
      - AUTH_JWKS_URL=https://your-oauth-provider/.well-known/jwks.json
      - OBSERVATION_SERVICE_URL=http://observation-service:3001
      - MONGO_URL=mongodb://mongo:27017/fhir
    depends_on:
      - mongo
      - observation-service

  observation-service:
    build: ./observation-service
    ports:
      - "3001:3001"
    environment:
      - AUTH_JWKS_URL=https://your-oauth-provider/.well-known/jwks.json
      - MONGO_URL=mongodb://mongo:27017/fhir
    depends_on:
      - mongo

  mongo:
    image: mongo:6
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

### Kubernetes Deployment Example

Create `k8s/main-fhir-server.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: main-fhir-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: main-fhir-server
  template:
    metadata:
      labels:
        app: main-fhir-server
    spec:
      containers:
      - name: fhir-server
        image: imranq2/node-fhir-server-mongo:latest
        ports:
        - containerPort: 3000
        env:
        - name: AUTH_JWKS_URL
          valueFrom:
            configMapKeyRef:
              name: fhir-config
              key: auth_jwks_url
        - name: OBSERVATION_SERVICE_URL
          value: "http://observation-service:3001"
---
apiVersion: v1
kind: Service
metadata:
  name: main-fhir-server
spec:
  selector:
    app: main-fhir-server
  ports:
  - port: 3000
    targetPort: 3000
```

Create `k8s/observation-service.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: observation-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: observation-service
  template:
    metadata:
      labels:
        app: observation-service
    spec:
      containers:
      - name: observation-service
        image: your-registry/observation-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: AUTH_JWKS_URL
          valueFrom:
            configMapKeyRef:
              name: fhir-config
              key: auth_jwks_url
---
apiVersion: v1
kind: Service
metadata:
  name: observation-service
spec:
  selector:
    app: observation-service
  ports:
  - port: 3001
    targetPort: 3001
```

## Security Considerations

1. **Token Validation**: The main FHIR server validates JWT tokens against the OAuth provider
2. **Inter-Service Communication**: Backend services should validate that requests come from the main server
3. **Network Security**: Use private networks or service mesh for backend communications
4. **Secrets Management**: Use Kubernetes secrets or AWS Secrets Manager for sensitive data

### Option 1: Mutual TLS (mTLS)

Configure mTLS between the main server and backend services:

```javascript
// In main FHIR server
const https = require('https');
const fs = require('fs');

const agent = new https.Agent({
    cert: fs.readFileSync('client-cert.pem'),
    key: fs.readFileSync('client-key.pem'),
    ca: fs.readFileSync('ca-cert.pem')
});

// Use this agent for backend service calls
axios.get(backendServiceUrl, {httpsAgent: agent});
```

### Option 2: Shared Secret

Use a shared secret for inter-service authentication:

```javascript
// In main FHIR server
headers: {
    'X-Internal-Secret': process.env.INTERNAL_SERVICE_SECRET,
    'Authorization': req.headers.authorization
}

// In backend service
app.use((req, res, next) => {
    const internalSecret = req.headers['x-internal-secret'];
    if (internalSecret !== process.env.INTERNAL_SERVICE_SECRET) {
        return res.status(403).send({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'forbidden',
                diagnostics: 'Invalid internal service credentials'
            }]
        });
    }
    next();
});
```

## Testing the Setup

### 1. Test Authentication Flow

```bash
# Get token from OAuth provider
curl --request POST \
  --url https://your-oauth-provider/oauth2/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data grant_type=client_credentials \
  --data client_id=your-client-id \
  --data client_secret=your-client-secret \
  --data 'scope=user/*.read access/myhealth.*'
```

### 2. Test Main Server

```bash
# Query through main FHIR server
curl --request GET \
  --url http://localhost:3000/4_0_0/Observation?subject=Patient/123 \
  --header 'Authorization: Bearer <token>'
```

### 3. Verify Backend Routing

Check logs to ensure requests are properly routed to backend services.

## Monitoring and Observability

### 1. Distributed Tracing

Use OpenTelemetry to trace requests across services:

```javascript
const {trace} = require('@opentelemetry/api');

// In proxy middleware
const span = trace.getActiveSpan();
span.setAttribute('backend.service', backendServiceUrl);
span.addEvent('proxying_to_backend');
```

### 2. Health Checks

Implement health check endpoints in backend services:

```javascript
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'observation-service',
        timestamp: new Date().toISOString()
    });
});
```

## Migration Strategy

### Phase 1: Setup (Week 1-2)
1. Deploy main FHIR server with proxy middleware
2. Set up one backend service (Observation)
3. Configure authentication flow

### Phase 2: Testing (Week 3-4)
1. Test authentication and authorization
2. Verify data integrity
3. Load testing

### Phase 3: Gradual Migration (Week 5+)
1. Route 10% of Observation traffic to backend
2. Monitor performance and errors
3. Gradually increase to 100%
4. Migrate other resources as needed

## Troubleshooting

### Common Issues

1. **401 Unauthorized from Backend**: Ensure JWT token is properly forwarded
2. **502 Bad Gateway**: Check backend service health and network connectivity
3. **Incorrect Data Filtering**: Verify access codes are properly extracted and passed

### Debug Mode

Enable debug logging:

```bash
# Main FHIR Server
DEBUG=express:router,fhir:proxy node src/index.js

# Backend Service
DEBUG=observation:* node index.js
```

## Additional Resources

- [FHIR Security](./security.md)
- [GraphQL Support](./graphql.md)
- [Performance Optimization](./performance.md)
- [Kafka Events](./kafkaEvents.md)
