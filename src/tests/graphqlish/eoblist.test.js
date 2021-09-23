const supertest = require('supertest');
const {app} = require('../../app');
// provider files
const ExplanationOfBenefitResource = require('./fixtures/eob.json');
const ExplanationOfBenefitResource2 = require('./fixtures/eob2.json');
const ExplanationOfBenefitResource3 = require('./fixtures/eob3.json');
// expected
const expectedSingleExplanationOfBenefitResource = require('./fixtures/expected_eoblist.json');

const async = require('async');

const request = supertest(app);
const { commonBeforeEach, commonAfterEach, getHeaders } = require('../common');

describe('ExplanationOfBenefitGraphQLishTests', () => {
  beforeEach(async () => {
    await commonBeforeEach();
  });

  afterEach(async () => {
    await commonAfterEach();
  });

  describe('ExplanationOfBenefit Search GraphQLish Test', () => {
    test.skip('search all eobs with graphqlish like request', async () => {
      await async.waterfall([
        (
          cb // first confirm there are no ExplanationOfBenefits
        ) =>
          request
            .get('/4_0_0/ExplanationOfBenefit')
            .set(getHeaders())
            .expect(200, (err, resp) => {
              expect(resp.body.length).toBe(0);
              console.log('------- response 1 ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response 1 ------------');
              return cb(err, resp);
            }),
        (results, cb) =>
          request
            .post('/4_0_0/ExplanationOfBenefit/EB3500/$merge?validate=true')
            .send(ExplanationOfBenefitResource)
            .set(getHeaders())
            .expect(200, (err, resp) => {
              console.log('------- response ExplanationOfBenefitResource ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response  ------------');
              expect(resp.body['created']).toBe(true);
              return cb(err, resp);
            }),
        (results, cb) =>
          request
            .post('/4_0_0/ExplanationOfBenefit/ee0887282befe3adfa36895ee5eb73e5d1764671/$merge')
            .send(ExplanationOfBenefitResource2)
            .set(getHeaders())
            .expect(200, (err, resp) => {
              console.log('------- response ExplanationOfBenefitResource ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response  ------------');
              expect(resp.body['created']).toBe(true);
              return cb(err, resp);
            }),
        (results, cb) =>
          request
            .post('/4_0_0/ExplanationOfBenefit/EB3501/$merge')
            .send(ExplanationOfBenefitResource3)
            .set(getHeaders())
            .expect(200, (err, resp) => {
              console.log('------- response ExplanationOfBenefitResource ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response  ------------');
              expect(resp.body['created']).toBe(true);
              return cb(err, resp);
            }),
        (results, cb) =>
          request
            .get('/4_0_0/ExplanationOfBenefit')
            .set(getHeaders())
            .expect(200, (err, resp) => {
              console.log('------- response 3 ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response 3 ------------');
              return cb(err, resp);
            }),
        (results, cb) =>
          request
            .get(
              '/graphql?query="{ ExplanationOfBenefit(_id:"EB3501"){ use id outcome meta {versionId} implicitRules status patient {   __typename   ...on Patient{ id   } } insurer {   __typename   ... on Organization{ id   } } provider{   __typename       ... on Practitioner{ id doctor_name: name{  prefix  given  family  text } gender   }   ... on Organization { id   } } meta {   versionId   lastUpdated   source } payee {   type{ coding{code}   } } careTeam {   provider{__typename} } supportingInfo{   sequence   category{ coding{code}   } } diagnosis{   sequence   type{coding{code}} } procedure {   sequence   procedureCodeableConcept{coding{code}} } insurance{   focal\n     } related {   relationship{coding{code}} } item {   id   sequence } type {   text   coding{ system code   }}}}"'
            )
            .set(getHeaders())
            .expect(200, cb)
            .expect((resp) => {
              console.log('------- response ExplanationOfBenefit sorted ------------');
              console.log(JSON.stringify(resp.body, null, 2));
              console.log('------- end response sort ------------');
              // clear out the lastUpdated column since that changes
              let body = resp.body;
              delete body['meta']['lastUpdated'];
              delete body['timestamp'];

              let expected = expectedSingleExplanationOfBenefitResource[0];
              delete expected['meta']['lastUpdated'];
              delete expected['timestamp'];
              delete expected['$schema'];

              expect(body).toStrictEqual(expected);
            }, cb),
      ]);
    });
  });
});
