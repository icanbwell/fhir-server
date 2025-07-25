const { jest } = require('@jest/globals');

// const {getToken} = require('../../token');
const { jwksEndpoint } = require('./mocks/jwks');
const { publicKey, privateKey } = require('./mocks/keys');
const { createToken } = require('./mocks/tokens');
const nock = require('nock');
const { createTestContainer } = require('./createTestContainer');
const supertest = require('supertest');
const { createApp } = require('../app');
const { createServer } = require('../server');
const { TestMongoDatabaseManager } = require('./testMongoDatabaseManager');
const httpContext = require('express-http-context');
const { fhirContentTypes } = require('../utils/contentTypes');
const { TestConfigManager } = require('./testConfigManager');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');

/**
 * @type {import('http').Server}
 */
let server;
/**
 * @type {import('supertest').Test}
 */
let tester;

/**
 *  @type {import('express').Express}
 */
let app;

/**
 * @type {SimpleContainer}
 */
let testContainer;

/**
 * @return {SimpleContainer}
 */
module.exports.getTestContainer = () => {
    return testContainer;
};

/**
 * Creates a test version of the app
 * @param {(SimpleContainer) => SimpleContainer} [fnUpdateContainer]
 * @return {import('express').Express}
 */
module.exports.createTestApp = (fnUpdateContainer) => {
    /**
     * @type {SimpleContainer}
     */
    testContainer = createTestContainer(fnUpdateContainer);
    return createApp({ fnGetContainer: () => testContainer, trackMetrics: false });
};

/**
 * @return {Promise<import('http').Server>}
 */
module.exports.createTestServer = async () => {
    return createServer(() => createTestContainer());
};

/**
 * @param {(SimpleContainer) => SimpleContainer|undefined} [fnUpdateContainer]
 * @return {import('supertest').Test}
 */
module.exports.createTestRequest = async (fnUpdateContainer) => {
    if (!app) {
        app = await module.exports.createTestApp((c) => {
            if (fnUpdateContainer) {
                fnUpdateContainer(c);
            }
            return c;
        });
    }
    // noinspection JSCheckFunctionSignatures
    tester = supertest(app);
    return tester;
};

/**
 * sets up the mongo db and token endpoint
 * @return {Promise<void>}
 */
module.exports.commonBeforeEach = async () => {
    // noinspection DynamicallyGeneratedCodeJS
    jest.setTimeout(30000);
    process.env.VALIDATE_SCHEMA = true;
    const urlObject = new URL(process.env.AUTH_JWKS_URL);
    jwksEndpoint(urlObject.protocol + '//' + urlObject.host, urlObject.pathname, [
        { pub: publicKey, kid: '123' }
    ]);
    /**
     * @type {string[]}
     */
    const extJwksUrls = process.env.EXTERNAL_AUTH_JWKS_URLS.split(',');
    extJwksUrls.forEach((extJwksUrl) => {
        if (extJwksUrl) {
            const urlObject1 = new URL(extJwksUrl.trim());
            jwksEndpoint(urlObject1.protocol + '//' + urlObject1.host, urlObject1.pathname, [
                {
                    pub: publicKey,
                    kid: '123'
                }
            ]);
        }
    });
};

/**
 * cleans up the mongo db
 * @return {Promise<void>}
 */
module.exports.commonAfterEach = async () => {
    if (testContainer) {
        /**
         * @type {PostRequestProcessor}
         */
        const postRequestProcessor = testContainer.postRequestProcessor;
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await testContainer.mongoDatabaseManager.dropDatabasesAsync();
        /**
         * @type {RequestSpecificCache}
         */
        const requestSpecificCache = testContainer.requestSpecificCache;
        await requestSpecificCache.clearAllAsync();
        // testContainer = null;
    }
    nock.cleanAll();
    // nock.restore(); // nock.activate()

    const configManager = testContainer?.configManager ?? new TestConfigManager();

    const testMongoDatabaseManager = new TestMongoDatabaseManager({ configManager });
    await testMongoDatabaseManager.dropDatabasesAsync();
    if (server) {
        await server.close();
        server = null;
    }
    tester = null;
    // app = null;
    // global.gc();
    // globals.clear();
};

/**
 * @param {string} scope
 * @return {string}
 */
const getToken = (module.exports.getToken = (scope) => {
    const payload = {
        sub: 'john',
        username: 'imran',
        client_id: 'my_client_id',
        scope,
        clientFhirPersonId: 'clientFhirPerson',
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: 'root-person',
        bwellFhirPatientId: 'bwellFhirPatient',
        managingOrganization: 'managingOrganization',
        token_use: 'access'
    };
    return createToken(privateKey, '123', payload);
});

const getFullAccessToken = (module.exports.getFullAccessToken = () => {
    return getToken('user/*.read user/*.write access/*.*');
});

const getTokenWithCustomClaims = (module.exports.getTokenWithCustomClaims = (scope) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        custom_client_id: 'my_custom_client_id',
        customscope: scope,
        groups: ['access/*.*'],
        token_use: 'access'
    });
});

const getTokenWithCustomPayload = (module.exports.getTokenWithCustomPayload = (payload) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        custom_client_id: 'my_custom_client_id',
        // if not present, it will be set
        managingOrganization: 'managingOrganization',
        ...payload
    });
});

const getFullAccessTokenWithCustomClaims = (module.exports.getFullAccessTokenWithCustomClaims =
    () => {
        return getTokenWithCustomClaims('user/*.read user/*.write');
    });

module.exports.getHeaders = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${scope !== null && scope !== undefined ? getToken(scope) : getFullAccessToken()}`,
        Host: 'localhost:3000'
    };
};

module.exports.getHeadersNdJson = (scope) => {
    return {
        'Content-Type': 'application/fhir+json', // what the data we POST is in
        Accept: 'application/fhir+ndjson, application/fhir+json; charset=utf-8', // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersCsv = (scope) => {
    return {
        'Content-Type': 'application/fhir+json', // what the data we POST is in
        Accept: fhirContentTypes.csv, // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersExcel = (scope) => {
    return {
        'Content-Type': 'application/fhir+json', // what the data we POST is in
        Accept: fhirContentTypes.excel, // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersFormUrlEncoded = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersNdJsonFormUrlEncoded = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/fhir+ndjson', // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersCsvFormUrlEncoded = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: fhirContentTypes.csv, // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersJsonPatch = (scope) => {
    return {
        'Content-Type': 'application/json-patch+json',
        Accept: 'application/fhir+json', // what we want the response to be in
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getGraphQLHeaders = (scope) => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        accept: '*/*',
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getGraphQLHeadersWithPerson = (personId) => {
    const payload = {
        scope: 'patient/*.read user/*.* access/*.*',
        username: 'patient-123@example.com',
        clientFhirPersonId: personId,
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: personId,
        bwellFhirPatientId: 'bwellFhirPatient',
        managingOrganization: 'managingOrganization',
        token_use: 'access'
    };
    return {
        'Content-Type': 'application/json; charset=utf-8',
        accept: '*/*',
        Authorization: `Bearer ${
            getTokenWithCustomPayload(payload)
        }`
    };
};

module.exports.getCustomGraphQLHeaders = (payload) => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        accept: '*/*',
        Authorization: `Bearer ${
            payload ? getTokenWithCustomPayload(payload) : getFullAccessToken()
        }`
    };
};

module.exports.getUnAuthenticatedGraphQLHeaders = () => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        accept: '*/*'
    };
};

module.exports.getUnAuthenticatedHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json'
    };
};

module.exports.getHeadersWithCustomToken = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${
            scope ? getTokenWithCustomClaims(scope) : getFullAccessTokenWithCustomClaims()
        }`
    };
};

module.exports.getHeadersWithCustomPayload = (payload) => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${getTokenWithCustomPayload(payload)}`
    };
};

module.exports.getUnAuthenticatedHtmlHeaders = () => {
    return {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36'
    };
};

module.exports.getHtmlHeaders = (scope) => {
    return {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36',
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHtmlHeadersWithForm = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36',
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersPreferOperationOutcome = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`,
        Host: 'localhost:3000',
        Prefer: 'return=OperationOutcome'
    };
};

const getTokenWithAdminClaims = (module.exports.getTokenWithAdminClaims = () => {
    return createToken(privateKey, '123', {
        sub: 'john',
        custom_client_id: 'my_custom_client_id',
        groups: ['admin/*.*'],
        token_use: 'access',
        scope: 'admin/*.* user/*.* access/*.*'
    });
});

module.exports.getJsonHeadersWithAdminToken = () => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${getTokenWithAdminClaims()}`
    };
};

module.exports.getHtmlHeadersWithAdminToken = () => {
    return {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        Authorization: `Bearer ${getTokenWithAdminClaims()}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36'
    };
};

/**
 * wraps a single resource into a bundle
 * @param {Object} resource
 * @return {{entry: [{resource: Object}], resourceType: string}}
 */
module.exports.wrapResourceInBundle = (resource) => {
    if (resource.resourceType === 'Bundle') {
        return resource; // already a bundle
    }
    return {
        resourceType: 'Bundle',
        total: 0,
        type: 'searchset',
        entry: [
            {
                resource
            }
        ]
    };
};

/**
 * @param resp
 * @return {string|undefined}
 */
module.exports.getRequestId = (resp) => {
    return resp.headers['x-request-id'];
};

/**
 * @description Mocks the get method of express-http-context to override requestId and userRequestId
 * @param {{systemGeneratedRequestId: string|undefined; userRequestId: string|undefined}} opts
 * @returns {string}
 */
module.exports.mockHttpContext = ({
                                      systemGeneratedRequestId,
                                      userRequestId
                                  } = {}) => {

    jest.spyOn(httpContext, 'get');
    const values = {
        systemGeneratedRequestId: systemGeneratedRequestId || '12345678',
        userRequestId: userRequestId || '1234'
    };
    httpContext.get.mockImplementation((key) => {
        return values[key];
    });
    return values.systemGeneratedRequestId;
};

/**
 * @param {string} requestId
 * @param {string|undefined} [scope]
 * @param {string|undefined} [userRequestId]
 * @returns {FhirRequestInfo}
 */
module.exports.getTestRequestInfo = ({
                                         requestId,
                                         scope = 'user/*.read user/*.write access/*.*',
                                         userRequestId
                                     }) => {
    if (!userRequestId) {
        userRequestId = requestId;
    }

    const requestInfo = new FhirRequestInfo(
        {
            user: '',
            scope,
            protocol: 'https',
            originalUrl: '',
            requestId,
            userRequestId,
            host: 'host',
            headers: {},
            method: 'POST',
            contentTypeFromHeader: null
        });
    return requestInfo;
};

/**
 *
 * @param resp
 * @returns {*}
 */
module.exports.parseNdjsonResponse = (resp) => {
    if (!resp.text || resp.text.trim() === '') {
        console.log('Warning: Empty response text');
        return [];
    }
    // Handle NDJSON by splitting on newlines and filtering out empty lines
    const lines = resp.text.trim().split('\n');
    // Process each line
    // Return the parsed results
    return lines
        .filter((line) => line.trim() !== '')
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch (e) {
                console.error('Failed to parse line:', line);
                throw e;
            }
        });
};
