/* eslint-disable no-unused-vars */
const { MongoClient } = require('mongodb');
const supertest = require('supertest');

const { app } = require('../../app');
const globals = require('../../globals');
const { CLIENT, CLIENT_DB } = require('../../constants');
const practitionerResource = require('./fixtures/providers/practitioner.json');
const locationResource = require('./fixtures/providers/location.json');
const practitionerRoleResource = require('./fixtures/providers/practitioner_role.json');
const async = require('async');

const request = supertest(app);

describe('Practitioner Integration Tests', () => {
  let connection;
  let db;
  // let resourceId;

  beforeAll(async () => {
    connection = await MongoClient.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    db = await connection.db();

    globals.set(CLIENT, connection);
    globals.set(CLIENT_DB, db);
  });

  afterAll(async () => {
    await connection.close();
  });

  describe('Practitioner Integration Tests', () => {
    test('Provider Files Loads', (done) => {
      async.waterfall([
        (cb) => // first confirm there are no practitioners
          request
            .get('/4_0_0/Practitioner')
            .set('Content-Type', 'application/fhir+json')
            .set('Accept', 'application/fhir+json')
            .expect(200, cb),
        (results, cb) =>
          request
            .post('/4_0_0/Practitioner')
            .send(practitionerResource)
            .set('Content-Type', 'application/fhir+json')
            .set('Accept', 'application/fhir+json')
            .expect(200, cb),
        (results, cb) =>
          request
            .post('/4_0_0/PractitionerRole')
            .send(practitionerRoleResource)
            .set('Content-Type', 'application/fhir+json')
            .set('Accept', 'application/fhir+json')
            .expect(200, cb),
        (results, cb) => request
          .post('/4_0_0/Location')
          .send(locationResource)
          .set('Content-Type', 'application/fhir+json')
          .set('Accept', 'application/fhir+json')
          .expect(200, cb),
        (results, cb) => request
          .get('/4_0_0/Practitioner')
          .set('Content-Type', 'application/fhir+json')
          .set('Accept', 'application/fhir+json')
          .expect(200, cb),
      ],
        (err, results) => {
          console.log('done');
          done();
        });
    });
  });
});
