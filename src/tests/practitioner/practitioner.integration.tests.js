const { MongoClient } = require('mongodb');
const supertest = require('supertest');

const { app } = require('../../app');
const globals = require('../../globals');
const { CLIENT, CLIENT_DB } = require('../../constants');
const practitionerResource = require('./fixtures/providers/practitioner.json');
const locationResource = require('./fixtures/providers/location.json');
const practitionerRoleResource = require('./fixtures/providers/practitioner_role.json');

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

  describe('Provider Files', () => {
    // test('invalid payloads should return a 400 with OperationOutcome', (done) => {
    //   request
    //     .post('/4_0_0/Practitioner')
    //     .send({ resourceType: 'Practitioner', valid: false })
    //     .set('Content-Type', 'application/fhir+json')
    //     .set('Accept', 'application/fhir+json')
    //     .end((err, resp) => {
    //       expect(err).toBeNull();
    //       expect(resp.status).toBe(400);
    //       expect(resp.body).toMatchObject({
    //         resourceType: 'OperationOutcome',
    //         issue: [
    //           {
    //             severity: 'error',
    //             code: 'invalid',
    //             details: {
    //               text:
    //                 '/4_0_0/Practitioner should NOT have additional properties :{"additionalProperty":"valid"}: at position root',
    //             },
    //           },
    //           {
    //             severity: 'error',
    //             code: 'invalid',
    //             details: {
    //               text:
    //                 '/4_0_0/Practitioner should match exactly one schema in oneOf :{"passingSchemas":null}: at position root',
    //             },
    //           },
    //         ],
    //       });
    //       done();
    //     });
    // });

    test('valid paylaods return 201 with header describing location', (done) => {
      request
        .post('/4_0_0/Practitioner')
        .send(practitionerResource)
        .set('Content-Type', 'application/fhir+json')
        .set('Accept', 'application/fhir+json')
        .end((err, resp) => {
          expect(err).toBeNull();
          expect(resp.status).toBe(201);
          expect(resp.headers.location.includes('4_0_0/Practitioner'));
          // resourceId = resp.headers.location.split('/Practitioner/')[1];
          done();
        });
        request
        .post('/4_0_0/PractitionerRole')
        .send(practitionerRoleResource)
        .set('Content-Type', 'application/fhir+json')
        .set('Accept', 'application/fhir+json')
        .end((err, resp) => {
          expect(err).toBeNull();
          expect(resp.status).toBe(201);
          expect(resp.headers.location.includes('4_0_0/Practitioner'));
          // resourceId = resp.headers.location.split('/Practitioner/')[1];
          done();
        });
        request
        .post('/4_0_0/Location')
        .send(locationResource)
        .set('Content-Type', 'application/fhir+json')
        .set('Accept', 'application/fhir+json')
        .end((err, resp) => {
          expect(err).toBeNull();
          expect(resp.status).toBe(201);
          expect(resp.headers.location.includes('4_0_0/Practitioner'));
          // resourceId = resp.headers.location.split('/Practitioner/')[1];
          done();
        });
    });
  });
});
