const documentReferenceAttachmentOtherTenantResource = require(
    './fixtures/documentReferenceAttachmentOtherTenant.json'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { isUuid } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The environment variable the path switch changes, restored after every test.
 */
const ENVIRONMENT_KEYS = ['WRITE_PIPELINE_OPERATIONS'];

/**
 * The headers of a caller who may create resources owned by `client` only, so that a resource
 * owned by `other-client` is rejected by the access check with 403 once it passes validation.
 */
const OTHER_TENANT_HEADERS = getHeaders('user/*.* access/client.*');

/**
 * Stands in for the id the server generated for the rejected resource, which differs on every run.
 */
const GENERATED_ID_PLACEHOLDER = '<generated-id>';

/**
 * Sends POST to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'create' : '';
};

/**
 * Reads every document stored in the resource type's collection straight from the MongoDB
 * database the server writes that resource type to.
 */
const readStoredDocuments = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`).find({}).toArray();
};

/**
 * Counts the files stored in GridFS straight from MongoDB.
 */
const countGridFsFilesAsync = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    return await db.collection('fs.files').countDocuments({});
};

/**
 * Returns the text with every token that is a uuid replaced by a placeholder.
 */
const withGeneratedIdMasked = (text) =>
    text
        .split(' ')
        .map((token) => (isUuid(token) ? GENERATED_ID_PLACEHOLDER : token))
        .join(' ');

describe('POST attachments on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'stores no attachment for a POST rejected with 403',
            path: 'new',
            expectedGridFsFilesAdded: 0
        },
        {
            name: 'stores the attachment of a POST rejected with 403 on the old path',
            path: 'old',
            expectedGridFsFilesAdded: 1
        }
    ];

    test.each(cases)('$name', async ({ path, expectedGridFsFilesAdded }) => {
        const request = await createTestRequest();
        useWritePath(path);
        const gridFsFilesBefore = await countGridFsFilesAsync();

        const resp = await request
            .post('/4_0_0/DocumentReference/')
            .send(documentReferenceAttachmentOtherTenantResource)
            .set(OTHER_TENANT_HEADERS);

        expect(resp.status).toBe(403);
        expect(resp.body.issue[0].code).toBe('forbidden');
        expect(withGeneratedIdMasked(resp.body.issue[0].details.text)).toBe(
            'user imran has no access to resource DocumentReference with id ' +
                GENERATED_ID_PLACEHOLDER
        );
        await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
            timeoutInSeconds: 20
        });
        expect(await readStoredDocuments('DocumentReference')).toStrictEqual([]);
        expect((await countGridFsFilesAsync()) - gridFsFilesBefore).toBe(expectedGridFsFilesAdded);
    });
});
