// test file
require('dotenv').config();

const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const condition1Resource = require('./fixtures/Condition/condition1.json');
const condition2Resource = require('./fixtures/Condition/condition2.json');

const expectedPatientBundle = require('./fixtures/expected/expected_Patient_bundle.json');
const expectedPatient = require('./fixtures/expected/expected_Patient.json');
const expectedPatientHeartDiseaseResources = require('./fixtures/expected/expected_Patient_heart_disease.json');
const expectedPatientContainedResources = require('./fixtures/expected/expected_Patient_contained.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');
const {FakeLLMFactory} = require('../../../chatgpt/llms/fakeLLMFactory');
const {FakeLLM} = require('../../../chatgpt/llms/fakeLLM');

// const describeIf = process.env.OPENAI_API_KEY ? describe : describe.skip;

class MockConfigManager extends ConfigManager {
    get writeFhirSummaryToVectorStore() {
        return true;
    }

    get enableMemoryVectorStore() {
        return true;
    }
}

describe('Person and Patient fake chatgpt Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const fakeLLM = new FakeLLM();

    describe('Person and Patient $everything chatgpt Tests', () => {
        test('Patient with age question', async () => {
            const mockedMethod = jest.spyOn(fakeLLM, '_call', undefined)
                .mockImplementation(
                    async (messages) => {
                        expect(messages.length).toBe(1);
                        if (messages[0].content.includes('Standalone question')) {
                            // this one is trying to rephrase the question
                            return 'What is this patient\'s date of birth?';
                        }
                        expect(messages[0].content).toInclude('December 31, 2016');
                        return 'The date of birth of this patient is December 31, 2016.';
                    }
                );
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register('llmFactory', () => {
                    return new FakeLLMFactory({
                        fnCreateLLM: () => fakeLLM
                    });
                });
                return container;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Condition/2/$merge?validate=true')
                .send(condition2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({timeoutInSeconds: 20});

            // ACT & ASSERT
            // First get patient everything
            const urlEncodedQuestion = encodeURIComponent("What is this patient's date of birth?");
            resp = await request
                .get(`/4_0_0/Patient/patient1/$everything?_question=${urlEncodedQuestion}`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientBundle);
            expect(mockedMethod).toHaveBeenCalledTimes(8);

            resp = await request
                .get(`/4_0_0/Patient/patient1/$everything?_question=${urlEncodedQuestion}&contained=true`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientContainedResources);
            resp = await request
                .get(`/4_0_0/Patient/patient1/?_question=${urlEncodedQuestion}`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatient);

            mockedMethod.mockReset();
        });
        test.skip('Patient with heart disease question', async () => {
            const mockedMethod = jest.spyOn(fakeLLM, '_call', undefined)
                .mockImplementation(
                    async (messages) => {
                        expect(messages.length).toBe(1);
                        expect(messages[0].content).toInclude('Resource: Patient');
                        return 'NO_OUTPUT';
                    }
                );
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register('llmFactory', () => {
                    return new FakeLLMFactory({
                        fnCreateLLM: () => fakeLLM
                    });
                });
                return container;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Condition/2/$merge?validate=true')
                .send(condition2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({timeoutInSeconds: 20});

            // ACT & ASSERT
            const urlEncodedQuestion2 = encodeURIComponent('Does this patient have heart disease?');
            resp = await request
                .get(`/4_0_0/Patient/patient1/?_question=${urlEncodedQuestion2}&_debug=1`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientHeartDiseaseResources, (resource) => {
                if (resource.text && resource.text.div && resource.text.div.indexOf('heart') >= 0) {
                    // handle the slight variations that ChatGPT produces
                    resource.text.div = 'The text suggests that the patient has a heart condition, specifically heart failure, ' +
                        'although it is unspecified.';
                }
                return resource;
            });
            expect(mockedMethod).toHaveBeenCalledTimes(8);
            mockedMethod.mockReset();
        });
    });
});
