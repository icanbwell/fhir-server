# Observation Backend Service

This is an example backend microservice for handling FHIR Observation resources in a microservices architecture.

## Features

- **Authentication**: Validates requests from the main FHIR server
- **Authorization**: Respects user scopes and access codes
- **FHIR Compliance**: Implements standard FHIR REST operations
- **Security**: Internal service authentication, access control
- **Logging**: Structured logging with Winston
- **Health Checks**: Built-in health check endpoint

## Prerequisites

- Node.js 24.5.0 or higher
- MongoDB 6.x
- Access to the main FHIR server

## Installation

```bash
npm install
```

## Configuration

Set the following environment variables:

```bash
# MongoDB Configuration
MONGO_URL=mongodb://mongo:27017/fhir
MONGO_DB_NAME=fhir

# Server Configuration
PORT=3001
NODE_ENV=development
LOG_LEVEL=info

# Security
INTERNAL_SERVICE_SECRET=your-secret-here
```

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Docker

```bash
# Build the image
docker build -t observation-service .

# Run the container
docker run -d \
  -p 3001:3001 \
  -e MONGO_URL=mongodb://mongo:27017/fhir \
  -e INTERNAL_SERVICE_SECRET=your-secret-here \
  --name observation-service \
  observation-service
```

## API Endpoints

### Health Check

```
GET /health
```

Returns the health status of the service.

### Search Observations

```
GET /4_0_0/Observation?subject=Patient/123&code=xyz
```

Search for observations with optional parameters:
- `subject`: Patient reference
- `code`: Observation code
- `category`: Observation category
- `date`: Observation date
- `status`: Observation status
- `_count`: Number of results to return (default: 10)
- `_getpagesoffset`: Offset for pagination (default: 0)

### Read Observation

```
GET /4_0_0/Observation/{id}
```

Get a specific observation by ID.

### Create Observation

```
POST /4_0_0/Observation
Content-Type: application/fhir+json

{
  "resourceType": "Observation",
  "id": "obs-123",
  "status": "final",
  "code": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "8867-4",
      "display": "Heart rate"
    }]
  },
  "subject": {
    "reference": "Patient/123"
  },
  "valueQuantity": {
    "value": 80,
    "unit": "beats/minute",
    "system": "http://unitsofmeasure.org",
    "code": "/min"
  }
}
```

### Update Observation

```
PUT /4_0_0/Observation/{id}
Content-Type: application/fhir+json

{
  "resourceType": "Observation",
  "id": "obs-123",
  ...
}
```

### Delete Observation

```
DELETE /4_0_0/Observation/{id}
```

## Authentication & Authorization

This service receives authenticated requests from the main FHIR server. The following headers are expected:

- `Authorization`: Bearer token (JWT)
- `X-Internal-Secret`: Internal service authentication secret
- `X-User-Scopes`: JSON array of user scopes
- `X-Access-Codes`: JSON array of access codes
- `X-Client-Person-Id`: Client person ID (optional)
- `X-Bwell-Person-Id`: Bwell person ID (optional)
- `X-Request-Id`: Request tracking ID (optional)

### Required Scopes

- `user/Observation.read` or `user/*.read` - Read observations
- `user/Observation.write` or `user/*.write` - Create/update/delete observations
- `user/*.*` - Full access to observations

### Access Control

Resources must have security tags that match the user's access codes:

```json
{
  "meta": {
    "security": [
      {
        "system": "https://www.icanbwell.com/access",
        "code": "myhealth"
      }
    ]
  }
}
```

## Integration with Main FHIR Server

### 1. Configure Main FHIR Server

Set environment variables in the main FHIR server:

```bash
ENABLE_RESOURCE_PROXY=true
OBSERVATION_SERVICE_URL=http://observation-service:3001
INTERNAL_SERVICE_SECRET=your-secret-here
```

### 2. Deploy Both Services

Use the provided docker-compose file or deploy to Kubernetes.

### 3. Test the Setup

```bash
# Get authentication token
TOKEN=$(curl -X POST https://your-oauth-provider/token \
  -d grant_type=client_credentials \
  -d client_id=your-client-id \
  -d client_secret=your-client-secret \
  -d scope="user/*.read access/myhealth.*" \
  | jq -r .access_token)

# Query observations through main FHIR server
curl -X GET http://localhost:3000/4_0_0/Observation?subject=Patient/123 \
  -H "Authorization: Bearer $TOKEN"
```

The main FHIR server will:
1. Authenticate the request
2. Validate the JWT token
3. Proxy the request to this backend service
4. Return the response to the client

## Monitoring

### Logs

The service uses structured JSON logging. All logs include:
- `timestamp`: ISO 8601 timestamp
- `level`: Log level (info, warn, error)
- `message`: Log message
- `requestId`: Request tracking ID (when available)

### Metrics

Consider adding metrics collection:
- Request count
- Response time
- Error rate
- Resource counts

## Development

### Adding New Resource Types

1. Create a new backend service (similar to this one)
2. Update the main FHIR server configuration
3. Add routing in the proxy middleware

### Testing

Add tests using Jest or another testing framework:

```bash
npm test
```

## Troubleshooting

### Service not receiving requests

1. Check that `OBSERVATION_SERVICE_URL` is set correctly in main server
2. Verify network connectivity between services
3. Check internal service secret configuration

### Authentication errors

1. Verify `INTERNAL_SERVICE_SECRET` matches in both services
2. Check that user context headers are being passed correctly

### MongoDB connection issues

1. Verify `MONGO_URL` is correct
2. Check MongoDB is running and accessible
3. Verify database permissions

## Security Best Practices

1. **Always use HTTPS** in production
2. **Rotate secrets** regularly
3. **Use strong internal service secrets**
4. **Implement rate limiting** to prevent abuse
5. **Monitor access logs** for suspicious activity
6. **Keep dependencies updated** to patch vulnerabilities
7. **Use container scanning** to detect security issues
8. **Implement audit logging** for compliance

## Performance Optimization

1. **Database indexes**: Ensure proper indexes on frequently queried fields
2. **Connection pooling**: Configure MongoDB connection pool size
3. **Caching**: Consider adding Redis for frequently accessed data
4. **Pagination**: Always use pagination for large result sets
5. **Compression**: Enable response compression for large payloads

## License

MIT
