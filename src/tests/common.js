/* eslint-disable no-unused-vars */
const {MongoClient} = require('mongodb');

const globals = require('../globals');
const {CLIENT, CLIENT_DB} = require('../constants');

const async = require('async');
const env = require('var');

// const {getToken} = require('../../token');
const {jwksEndpoint} = require('./mocks/jwks');
const {publicKey, privateKey} = require('./mocks/keys');
const {createToken} = require('./mocks/tokens');

let connection;
let db;

module.exports.commonBeforeEach = async () => {
    connection = await MongoClient.connect(process.env.MONGO_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        server: {
            auto_reconnect: true,
            socketOptions: {

                keepAlive: 1,
                connectTimeoutMS: 60000,
                socketTimeoutMS: 60000,
            }
        }
    });
    db = connection.db();

    globals.set(CLIENT, connection);
    globals.set(CLIENT_DB, db);
    jest.setTimeout(30000);
    env['VALIDATE_SCHEMA'] = true;
    process.env.AUTH_ENABLED = '1';
    jwksEndpoint('http://foo:80', [{pub: publicKey, kid: '123'}]);
};

module.exports.commonAfterEach = async () => {
    await db.dropDatabase();
    await connection.close();
};


const getToken = module.exports.getToken = (scope) => {
    return createToken(privateKey, '123', {
        sub: 'john',
        client_id: 'my_client_id',
        scope: scope
    });
};

const getDefaultToken = module.exports.getDefaultToken = () => {
    return getToken(
        'user/Practitioner.read user/Practitioner.write access/medstar.* access/thedacare.*'
    );
};

module.exports.getHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
        'Authorization': `Bearer ${getDefaultToken()}`
    };
};

