const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedPersonBeforeUpdateResources = require('./fixtures/expected/expected_Person_before_update.json');
const expectedPerson3Resources = require('./fixtures/expected/expected_Person3.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');

const base_version = '4_0_0';
const personId = '9b3326ba-2421-4b9a-9d57-1eba0481cbd4';

const identityExtensionUrls = [
    'https://www.icanbwell.com/sourceId',
    'https://www.icanbwell.com/uuid',
    'https://www.icanbwell.com/sourceAssigningAuthority'
];

const toWriteDoc = (resource) => FhirResourceWriteSerializer.serialize({ obj: deepcopy(resource) });

const withoutIdentityExtensions = (value) => {
    if (Array.isArray(value)) {
        return value.map(withoutIdentityExtensions);
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, child]) => [
                key,
                key === 'extension' && Array.isArray(child)
                    ? child.filter((e) => !identityExtensionUrls.includes(e.url))
                    : child
            ])
            .filter(([key, child]) => !(key === 'extension' && child.length === 0))
            .map(([key, child]) => [key, withoutIdentityExtensions(child)])
    );
};

describe('FastDatabaseUpdateManager Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const setupAsync = async () => {
        await createTestRequest();
        const container = getTestContainer();
        const databaseUpdateManager = container.databaseUpdateFactory.createFastDatabaseUpdateManager({
            resourceType: 'Person',
            base_version
        });
        const databaseQueryManager = container.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        const requestInfo = getTestRequestInfo({ requestId: '123' });
        const readPersonAsync = async () => {
            const doc = await databaseQueryManager.fastFindOneAsync({ query: { id: personId } });
            doc.meta.lastUpdated = null;
            return withoutIdentityExtensions(FhirResourceSerializer.serialize(doc));
        };
        return { databaseUpdateManager, requestInfo, readPersonAsync };
    };

    test('works with normal replace', async () => {
        const { databaseUpdateManager, requestInfo, readPersonAsync } = await setupAsync();
        await databaseUpdateManager.insertOneAsync({ base_version, requestInfo, doc: toWriteDoc(person1Resource) });

        expect(await readPersonAsync()).toStrictEqual(expectedPersonBeforeUpdateResources);

        await databaseUpdateManager.replaceOneAsync({ base_version, requestInfo, doc: toWriteDoc(person2Resource) });

        expect(await readPersonAsync()).toStrictEqual(expectedPersonResources);
    });

    test.each([
        ['the same replace twice', [person2Resource, person2Resource], expectedPersonResources],
        ['different replaces in sequence', [person2Resource, person3Resource], expectedPerson3Resources]
    ])('works with %s', async (_name, replacements, expected) => {
        const { databaseUpdateManager, requestInfo, readPersonAsync } = await setupAsync();
        await databaseUpdateManager.insertOneAsync({ base_version, requestInfo, doc: toWriteDoc(person1Resource) });

        for (const replacement of replacements) {
            await databaseUpdateManager.replaceOneAsync({ base_version, requestInfo, doc: toWriteDoc(replacement) });
        }

        expect(await readPersonAsync()).toStrictEqual(expected);
    });
});
