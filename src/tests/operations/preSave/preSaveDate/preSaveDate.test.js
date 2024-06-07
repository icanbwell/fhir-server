const carePlan1Resource = require('./fixtures/careplan1.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const Resource = require('../../../../fhir/classes/4_0_0/resources/carePlan');
const { assertTypeEquals } = require('../../../../utils/assertType');
const activityDetails0String = '2023-10-06';
const activityDetails1StartDate = 'Jan 1, 2023';
const activityDetails1EndDate = '02/28/2023';
const activityDetails2String = '2022/05/21';
const metaLastUpdatedDate = new Date('2024-04-17T15:18:45.000Z');
const badDate = 'bad date';

describe('PreSave Date Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('PreSave date with valid and invalid tests', () => {
        const base_version = '4_0_0';
        test('PreSave date formatted as dates', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {PreSaveManager}
             */
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const resource = new Resource(carePlan1Resource);
            const result = await preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            const newResource = new Resource(result);
            expect(newResource.activity[0].detail.scheduledString).toEqual(activityDetails0String);
            expect(newResource.activity[1].detail.scheduledPeriod.start).toEqual(activityDetails1StartDate);
            expect(newResource.activity[1].detail.scheduledPeriod.end).toEqual(activityDetails1EndDate);
            expect(newResource.activity[2].detail.scheduledString).toEqual(activityDetails2String);
            expect(newResource.meta.lastUpdated).toEqual(metaLastUpdatedDate);
            expect(newResource.created).toEqual(badDate);
        });
    });
});
