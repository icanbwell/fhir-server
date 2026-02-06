# Microservices Setup Guide

This guide walks you through setting up a microservices architecture for the FHIR server where authentication and authorization are centralized in the main FHIR server, but Observation resources (and potentially other resources) are handled by separate backend services.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Detailed Setup](#detailed-setup)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Production Deployment](#production-deployment)
7. [Troubleshooting](#troubleshooting)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Client                              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS with JWT
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          Main FHIR Server (API Gateway)                     │
│  • Authenticates JWT tokens                                 │
│  • Validates scopes and access codes                        │
│  • Routes requests to appropriate backend services          │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
    ┌────────▼────────┐     ┌────────▼────────┐
    │  Observation    │     │   Other FHIR    │
    │    Service      │     │   Resources     │
    │  (Port 3001)    │     │  (Main Server)  │
    └────────┬────────┘     └────────┬────────┘
             │                        │
             └──────────┬─────────────┘
                        │
                 ┌──────▼──────┐
                 │   MongoDB   │
                 └─────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/icanbwell/fhir-server.git
cd fhir-server
```

### 2. Start the Services

```bash
docker-compose -f docker-compose-microservices.yml up -d
```

This will start:
- Main FHIR Server (port 3000)
- Observation Backend Service (port 3001)
- MongoDB (port 27017)
- Keycloak (port 8080)

### 3. Wait for Services to be Ready

```bash
# Check service health
docker-compose -f docker-compose-microservices.yml ps

# View logs
docker-compose -f docker-compose-microservices.yml logs -f
```

### 4. Get Authentication Token

```bash
# Get a service account token from Keycloak
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.read user/*.write access/*.*' \
  | jq -r .access_token
```

Save the token to a variable:

```bash
TOKEN=$(curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.read user/*.write access/*.*' \
  | jq -r .access_token)
```

### 5. Test the Setup

```bash
# Create an Observation (will be routed to the backend service)
curl --request POST \
  --url http://localhost:3000/4_0_0/Observation \
  --header "Authorization: Bearer $TOKEN" \
  --header "Content-Type: application/fhir+json" \
  --data '{
    "resourceType": "Observation",
    "id": "test-obs-1",
    "status": "final",
    "code": {
      "coding": [{
        "system": "http://loinc.org",
        "code": "8867-4",
        "display": "Heart rate"
      }]
    },
    "subject": {
      "reference": "Patient/test-patient-1"
    },
    "valueQuantity": {
      "value": 80,
      "unit": "beats/minute",
      "system": "http://unitsofmeasure.org",
      "code": "/min"
    },
    "meta": {
      "security": [
        {
          "system": "https://www.icanbwell.com/owner",
          "code": "test"
        },
        {
          "system": "https://www.icanbwell.com/access",
          "code": "test"
        }
      ]
    }
  }'

# Search for Observations (will be routed to the backend service)
curl --request GET \
  --url "http://localhost:3000/4_0_0/Observation?subject=Patient/test-patient-1" \
  --header "Authorization: Bearer $TOKEN"

# Read a specific Observation (will be routed to the backend service)
curl --request GET \
  --url "http://localhost:3000/4_0_0/Observation/test-obs-1" \
  --header "Authorization: Bearer $TOKEN"
```

## Detailed Setup

### Step 1: Configure Main FHIR Server

The main FHIR server needs to be configured to act as an API gateway. This is done through environment variables.

#### Required Environment Variables

```bash
# Enable the proxy middleware
ENABLE_RESOURCE_PROXY=true

# Backend service URLs
OBSERVATION_SERVICE_URL=http://observation-service:3001

# Internal service authentication
INTERNAL_SERVICE_SECRET=your-strong-secret-here

# Authentication configuration
AUTH_JWKS_URL=https://your-oauth-provider/.well-known/jwks.json
AUTH_CODE_FLOW_URL=https://your-oauth-provider/oauth2/authorize
AUTH_CODE_FLOW_CLIENT_ID=your-client-id
AUTH_CONFIGURATION_URI=https://your-oauth-provider/.well-known/openid-configuration
```

### Step 2: Set Up Backend Services

#### Create Observation Service

1. Navigate to the examples directory:

```bash
cd examples/observation-backend-service
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
# Create .env file
cat > .env << EOF
MONGO_URL=mongodb://localhost:27017/fhir
MONGO_DB_NAME=fhir
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
INTERNAL_SERVICE_SECRET=your-strong-secret-here
EOF
```

4. Start the service:

```bash
npm start
```

### Step 3: Configure MongoDB

Ensure MongoDB is running and accessible to both services:

```bash
# Using Docker
docker run -d \
  -p 27017:27017 \
  -v mongo-data:/data/db \
  --name fhir-mongo \
  mongo:6
```

### Step 4: Configure Authentication Provider

Set up Keycloak or your preferred OAuth provider:

```bash
# Using Docker
docker run -d \
  -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin-user \
  -e KEYCLOAK_ADMIN_PASSWORD=password \
  --name fhir-keycloak \
  quay.io/keycloak/keycloak:latest start-dev
```

Create a client for the FHIR server in Keycloak with appropriate scopes.

## Configuration

### Main FHIR Server Configuration

Create or update `.env` in the main FHIR server directory:

```bash
# Database
MONGO_URL=mongodb://mongo:27017/fhir
MONGO_DB_NAME=fhir

# Authentication
AUTH_JWKS_URL=http://keycloak:8080/realms/master/protocol/openid-connect/certs
AUTH_CODE_FLOW_URL=http://localhost:8080/realms/master/protocol/openid-connect/auth
AUTH_CODE_FLOW_CLIENT_ID=bwell-client-id
AUTH_CONFIGURATION_URI=http://keycloak:8080/realms/master/.well-known/openid-configuration

# Microservices
ENABLE_RESOURCE_PROXY=true
OBSERVATION_SERVICE_URL=http://observation-service:3001
INTERNAL_SERVICE_SECRET=change-this-secret-in-production

# Server
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
```

### Backend Service Configuration

Create `.env` in each backend service directory:

```bash
# Database
MONGO_URL=mongodb://mongo:27017/fhir
MONGO_DB_NAME=fhir

# Security
INTERNAL_SERVICE_SECRET=change-this-secret-in-production

# Server
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

### Security Configuration

1. **Generate Strong Secrets**:

```bash
# Generate a strong random secret
openssl rand -base64 32
```

2. **Configure Scopes**: Ensure your OAuth provider is configured with the required scopes:
   - `user/*.read` - Read any resource
   - `user/*.write` - Write any resource
   - `user/Observation.read` - Read observations
   - `user/Observation.write` - Write observations
   - `access/*.*` - Access all resources

3. **Configure Access Tags**: Resources should have security tags:

```json
{
  "meta": {
    "security": [
      {
        "system": "https://www.icanbwell.com/owner",
        "code": "your-organization"
      },
      {
        "system": "https://www.icanbwell.com/access",
        "code": "your-organization"
      }
    ]
  }
}
```

## Testing

### Unit Tests

Test individual components:

```bash
# Test the proxy middleware
npm test -- src/middleware/fhir/resourceProxy.middleware.test.js

# Test the backend service
cd examples/observation-backend-service
npm test
```

### Integration Tests

Test the complete flow:

```bash
# 1. Start all services
docker-compose -f docker-compose-microservices.yml up -d

# 2. Run integration tests
npm run test:integration

# 3. Stop services
docker-compose -f docker-compose-microservices.yml down
```

### Manual Testing

#### Test Authentication

```bash
# Get token
TOKEN=$(curl -s --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.* access/*.*' \
  | jq -r .access_token)

# Verify token
echo $TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | jq
```

#### Test Proxying

```bash
# Direct request to backend service (should fail without internal secret)
curl --request GET \
  --url http://localhost:3001/4_0_0/Observation \
  --header "Authorization: Bearer $TOKEN"

# Request through main server (should succeed)
curl --request GET \
  --url http://localhost:3000/4_0_0/Observation \
  --header "Authorization: Bearer $TOKEN"
```

#### Test Authorization

```bash
# Request with insufficient scopes (should fail)
TOKEN_NO_ACCESS=$(curl -s --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/Patient.read' \
  | jq -r .access_token)

curl --request GET \
  --url http://localhost:3000/4_0_0/Observation \
  --header "Authorization: Bearer $TOKEN_NO_ACCESS"
```

## Production Deployment

### Kubernetes Deployment

#### 1. Create ConfigMaps

```bash
kubectl create configmap fhir-config \
  --from-literal=mongo_url=mongodb://mongo-service:27017/fhir \
  --from-literal=auth_jwks_url=https://your-oauth-provider/.well-known/jwks.json \
  --from-literal=observation_service_url=http://observation-service:3001
```

#### 2. Create Secrets

```bash
kubectl create secret generic fhir-secrets \
  --from-literal=internal_service_secret=$(openssl rand -base64 32)
```

#### 3. Deploy Services

Apply the Kubernetes manifests from the `readme/microservices-architecture.md` file.

### AWS Deployment

Use AWS ECS or EKS for container orchestration:

1. **Build and Push Images**:

```bash
# Build images
docker build -t your-registry/fhir-server:latest .
docker build -t your-registry/observation-service:latest ./examples/observation-backend-service

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-registry
docker push your-registry/fhir-server:latest
docker push your-registry/observation-service:latest
```

2. **Create ECS Task Definitions**
3. **Configure Load Balancers**
4. **Set up Auto-scaling**

### Monitoring

#### Set Up CloudWatch/Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'fhir-server'
    static_configs:
      - targets: ['main-fhir-server:3000']
  
  - job_name: 'observation-service'
    static_configs:
      - targets: ['observation-service:3001']
```

#### Configure Alerts

```yaml
# alerts.yml
groups:
  - name: fhir-services
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"
```

## Troubleshooting

### Common Issues

#### 1. 502 Bad Gateway

**Symptom**: Requests to the main server return 502 errors.

**Solution**:
- Check if backend service is running: `docker-compose ps`
- Verify service URL configuration: `OBSERVATION_SERVICE_URL`
- Check network connectivity between services
- Review logs: `docker-compose logs observation-service`

#### 2. 403 Forbidden

**Symptom**: Requests return 403 even with valid token.

**Solution**:
- Verify scopes in the token: `echo $TOKEN | cut -d'.' -f2 | base64 -d | jq`
- Check resource security tags match access codes
- Verify internal service secret matches in both services

#### 3. Authentication Failures

**Symptom**: 401 Unauthorized errors.

**Solution**:
- Verify OAuth provider is accessible
- Check AUTH_JWKS_URL is correct
- Ensure token hasn't expired
- Verify client credentials

#### 4. Database Connection Issues

**Symptom**: Cannot connect to MongoDB.

**Solution**:
- Check MongoDB is running: `docker-compose ps mongo`
- Verify MONGO_URL is correct
- Check network connectivity
- Review MongoDB logs: `docker-compose logs mongo`

### Debug Mode

Enable debug logging:

```bash
# Main FHIR Server
DEBUG=express:router,fhir:* npm start

# Backend Service
LOG_LEVEL=debug npm start
```

### Health Checks

```bash
# Check main server health
curl http://localhost:3000/health

# Check backend service health
curl http://localhost:3001/health

# Check MongoDB
mongosh mongodb://localhost:27017/fhir --eval "db.adminCommand('ping')"
```

## Next Steps

1. **Add More Backend Services**: Follow the same pattern for other resource types
2. **Implement Caching**: Add Redis for improved performance
3. **Set Up Monitoring**: Configure Prometheus and Grafana
4. **Add Rate Limiting**: Protect services from abuse
5. **Implement Circuit Breakers**: Handle backend service failures gracefully
6. **Set Up CI/CD**: Automate deployment pipelines

## Additional Resources

- [Microservices Architecture Documentation](./microservices-architecture.md)
- [FHIR Security Guide](./security.md)
- [Performance Optimization](./performance.md)
- [Backend Service Example](../examples/observation-backend-service/README.md)

## Support

For issues and questions:
- GitHub Issues: https://github.com/icanbwell/fhir-server/issues
- Documentation: https://github.com/icanbwell/fhir-server/tree/main/readme
