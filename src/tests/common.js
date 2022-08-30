const {MongoClient} = require('mongodb');
const {MongoMemoryServer} = require('mongodb-memory-server');

const globals = require('../globals');
const {CLIENT, CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../constants');

const env = require('var');

// const {getToken} = require('../../token');
const {jwksEndpoint} = require('./mocks/jwks');
const {publicKey, privateKey} = require('./mocks/keys');
const {createToken} = require('./mocks/tokens');
const nock = require('nock');
const {createTestContainer} = require('./createTestContainer');
const supertest = require('supertest');
const {createApp} = require('../app');
const {createServer} = require('../server');


let connection;
let db;
let mongo;
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
    return createApp(() => testContainer);
};

/**
 * @return {Promise<import('http').Server>}
 */
module.exports.createTestServer = async () => {
    return createServer(() => createTestContainer());
};

/**
 * @param {(SimpleContainer) => SimpleContainer} [fnUpdateContainer]
 * @return {import('supertest').Test}
 */
module.exports.createTestRequest = async (fnUpdateContainer) => {
    if (!app) {
        app = await module.exports.createTestApp(fnUpdateContainer);
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
    // https://levelup.gitconnected.com/testing-your-node-js-application-with-an-in-memory-mongodb-976c1da1288f
    /**
     * 1.1
     * Start in-memory MongoDB
     */
    if (!mongo) {
        mongo = await MongoMemoryServer.create();
    }
    /**
     * 1.2
     * Set the MongoDB host and DB name as environment variables,
     * because the application expect it as ENV vars.
     * The values are being created by the in-memory MongoDB
     */
    process.env.MONGO_URL = mongo.getUri();
    // process.env.MONGO_DB = mongo.getdb.getDbName();

    connection = await MongoClient.connect(process.env.MONGO_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    db = connection.db();
    const auditEventDb = connection.db('audit_events');

    globals.set(CLIENT, connection);
    globals.set(CLIENT_DB, db);
    globals.set(AUDIT_EVENT_CLIENT_DB, auditEventDb);
    jest.setTimeout(30000);
    env['VALIDATE_SCHEMA'] = true;
    process.env.AUTH_ENABLED = '1';
    const urlObject = new URL(env.AUTH_JWKS_URL);
    jwksEndpoint(urlObject.protocol + '//' + urlObject.host, urlObject.pathname, [{pub: publicKey, kid: '123'}]);
    /**
     * @type {string[]}
     */
    const extJwksUrls = env.EXTERNAL_AUTH_JWKS_URLS.split(',');
    extJwksUrls.forEach(
        extJwksUrl => {
            if (extJwksUrl) {
                const urlObject1 = new URL(extJwksUrl.trim());
                jwksEndpoint(urlObject1.protocol + '//' + urlObject1.host, urlObject1.pathname, [{
                    pub: publicKey,
                    kid: '123'
                }]);
            }
        }
    );
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
        await postRequestProcessor.waitTillDoneAsync(20);
    }
    globals.delete(CLIENT);
    globals.delete(CLIENT_DB);
    nock.cleanAll();
    nock.restore();
    if (db) {
        await db.dropDatabase();
        db = null;
    }
    const auditDatabase = globals.get(AUDIT_EVENT_CLIENT_DB);
    if (auditDatabase) {
        await auditDatabase.dropDatabase();
        globals.delete(AUDIT_EVENT_CLIENT_DB);
    }
    if (connection) {
        await connection.close();
        connection = null;
    }
    if (mongo) {
        await mongo.stop();
        mongo = null;
    }
    if (server) {
        await server.close();
        server = null;
    }
    tester = null;
    // app = null;
    // global.gc();
    globals.clear();
};


/**
 * @param {string} scope
 * @return {string}
 */
const getToken = module.exports.getToken = (scope) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        username: 'imran',
        client_id: 'my_client_id',
        scope: scope
    });
};

const getFullAccessToken = module.exports.getFullAccessToken = () => {
    return getToken(
        'user/*.read user/*.write access/*.*'
    );
};

const getTokenWithCustomClaims = module.exports.getTokenWithCustomClaims = (scope) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        custom_client_id: 'my_custom_client_id',
        customscope: scope,
        groups: ['access/*.*']
    });
};

const getTokenWithCustomPayload = module.exports.getTokenWithCustomClaims = (payload) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        custom_client_id: 'my_custom_client_id',
        ...payload
    });
};


const getFullAccessTokenWithCustomClaims = module.exports.getFullAccessTokenWithCustomClaims = () => {
    return getTokenWithCustomClaims(
        'user/*.read user/*.write'
    );
};

module.exports.getHeaders = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`,
        'Host': 'localhost:3000'
    };
};

module.exports.getHeadersNdJson = (scope) => {
    return {
        'Content-Type': 'application/fhir+json', // what the data we POST is in
        'Accept': 'application/fhir+ndjson', // what we want the response to be in
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersFormUrlEncoded = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersNdJsonFormUrlEncoded = (scope) => {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/fhir+ndjson', // what we want the response to be in
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getGraphQLHeaders = (scope) => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        'accept': '*/*',
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getCustomGraphQLHeaders = (payload) => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        'accept': '*/*',
        'Authorization': `Bearer ${payload ? getTokenWithCustomPayload(payload) : getFullAccessToken()}`
    };
};

module.exports.getUnAuthenticatedGraphQLHeaders = () => {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        'accept': '*/*',
    };
};

module.exports.getUnAuthenticatedHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
    };
};

module.exports.getHeadersWithCustomToken = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${scope ? getTokenWithCustomClaims(scope) : getFullAccessTokenWithCustomClaims()}`
    };
};

module.exports.getHeadersWithCustomPayload = (payload) => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${getTokenWithCustomPayload(payload)}`
    };
};

module.exports.getHtmlHeaders = (scope) => {
    return {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36',
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`
    };
};

module.exports.getHeadersPreferOperationOutcome = (scope) => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${scope ? getToken(scope) : getFullAccessToken()}`,
        'Host': 'localhost:3000',
        'Prefer': 'return=OperationOutcome'
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
        'resourceType': 'Bundle',
        'total': 0,
        'type': 'searchset',
        'entry': [
            {
                'resource': resource
            }
        ]
    };
};
