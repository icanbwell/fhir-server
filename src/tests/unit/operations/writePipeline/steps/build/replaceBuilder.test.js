const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../../preSaveHandlers/preSave');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { ResourceMerger } = require('../../../../../../operations/common/resourceMerger');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../../../dataLayer/base64DataManager');
const { PostSaveHandlerFactory } = require('../../../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory');
const { MongoDatabaseManager } = require('../../../../../../utils/mongoDatabaseManager');
const { RequestSpecificCache } = require('../../../../../../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../../../../../../utils/fhirRequestInfo');
const { ReplaceBuilder } = require('../../../../../../operations/writePipeline/steps/build/replaceBuilder');
const { InsertBuilder } = require('../../../../../../operations/writePipeline/steps/build/insertBuilder');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');

const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';
const SAA_SYSTEM = 'https://www.icanbwell.com/sourceAssigningAuthority';
const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const STORED_LAST_UPDATED = '2024-01-01T00:00:00.000Z';

/**
 * Builds a synthetic body of the given type and id with an owner and an access tag.
 * @param {string} resourceType
 * @param {string} id
 * @param {Object} fields
 * @returns {Object}
 */
const body = ({ resourceType = 'Patient', id = 'resource-1', ...fields }) => ({
    resourceType,
    id,
    meta: {
        source: 'https://example.test/source',
        security: [
            { system: OWNER_SYSTEM, code: 'owner' },
            { system: ACCESS_SYSTEM, code: 'owner' }
        ]
    },
    ...fields
});

/**
 * Builds the stored form of a body: its identity fields, the source assigning authority tag the
 * pre-save handlers add, and the given version and stored `lastUpdated`.
 * @param {Object} resource
 * @param {string|null} versionId - null leaves the stored doc without a versionId
 * @param {Object} extra
 * @returns {Object}
 */
const stored = (resource, { versionId = '2', ...extra } = {}) => {
    const doc = deepcopy(resource);
    doc.meta.security.push({ system: SAA_SYSTEM, code: 'owner' });
    if (versionId !== null) {
        doc.meta.versionId = versionId;
    }
    doc.meta.lastUpdated = STORED_LAST_UPDATED;
    doc._sourceAssigningAuthority = 'owner';
    doc._uuid = generateUUIDv5(`${resource.id}|owner`);
    return { ...doc, ...extra };
};

/**
 * Builds a configManager whose source-tag rule is off and whose date-only types are the default.
 * @returns {ConfigManager}
 */
const buildConfigManager = () => {
    const configManager = new ConfigManager();
    Object.defineProperty(configManager, 'requireMetaSourceTags', { get: () => false });
    return configManager;
};

/**
 * Builds the builder with the real merger, pre-save handlers and attachment managers (GridFS and
 * base64 storage are off), and a post-save handler factory that returns a ClickHouse handler for
 * Group only when `clickHouseGroup` is set.
 * @param {boolean} clickHouseGroup
 * @returns {ReplaceBuilder}
 */
const buildBuilder = ({ clickHouseGroup }) => {
    const configManager = buildConfigManager();
    const preSaveManager = new PreSaveManager({
        preSaveHandlers: [
            new SourceAssigningAuthorityColumnHandler({ configManager }),
            new UuidColumnHandler()
        ]
    });
    const postSaveHandlerFactory = Object.create(PostSaveHandlerFactory.prototype);
    postSaveHandlerFactory.getHandlers = (resourceType) =>
        clickHouseGroup && resourceType === 'Group' ? [{ name: 'clickHouseGroupHandler' }] : [];
    return new ReplaceBuilder({
        resourceMerger: new ResourceMerger({ preSaveManager, configManager }),
        databaseAttachmentManager: new DatabaseAttachmentManager({
            mongoDatabaseManager: Object.create(MongoDatabaseManager.prototype),
            configManager
        }),
        base64DataManager: new Base64DataManager({
            configManager,
            requestSpecificCache: Object.create(RequestSpecificCache.prototype),
            preSaveManager
        }),
        postSaveHandlerFactory,
        insertBuilder: new InsertBuilder()
    });
};

/**
 * Builds a request info with the given headers.
 * @param {Object} headers
 * @returns {FhirRequestInfo}
 */
const buildRequestInfo = (headers) => new FhirRequestInfo({
    user: 'test-user',
    scope: 'user/*.* access/*.*',
    requestId: 'request-1',
    protocol: 'https',
    originalUrl: '/4_0_0/Patient/resource-1',
    host: 'localhost',
    headers,
    method: 'PUT'
});

/**
 * Runs the builder for one item and returns what came out: the failure's stage and its error's
 * status code, issue code and message, or the write mode and, for the candidate, its version, whether it is the body object
 * itself, and the given fields.
 * @param {Object|null} storedDoc
 * @param {Object} headers
 * @param {Object} incoming
 * @param {boolean} clickHouseGroup
 * @param {string[]} fields
 * @returns {Promise<Object>}
 */
const build = async ({ storedDoc, headers, incoming, clickHouseGroup = false, fields = [] }) => {
    const item = new WriteItem({ index: 0, incoming });
    item.stored = storedDoc;
    const context = new WriteContext({
        requestInfo: buildRequestInfo(headers),
        base_version: '4_0_0',
        parsedArgs: {},
        smartMerge: false
    });
    const failure = await buildBuilder({ clickHouseGroup }).buildAsync({ item, context });
    if (failure) {
        return {
            stage: failure.stage,
            statusCode: failure.error.statusCode,
            issueCode: failure.error.issue[0].code,
            message: failure.error.message
        };
    }
    const candidate = item.candidate;
    return {
        writeMode: item.writeMode,
        candidate: candidate && {
            versionId: candidate.meta.versionId,
            isBody: candidate === incoming,
            ...Object.fromEntries(fields.map((field) => [field, candidate[`${field}`]]))
        }
    };
};

const patient = body({ name: [{ family: 'Synthetic' }], active: true });
const groupMembers = [{ entity: { reference: 'Patient/member-1' } }];
const group = body({ resourceType: 'Group', id: 'group-1', type: 'person', actual: true, member: groupMembers });
const composition = ({ date }) => body({ resourceType: 'Composition', id: 'composition-1', status: 'final', date });

describe('ReplaceBuilder', () => {
    test.each([
        {
            name: 'an extended stored Group with members in the body fails with the 400 BadRequestError pointing to PATCH',
            storedDoc: stored(group, { _extended: true }),
            headers: {},
            incoming: deepcopy(group),
            expected: {
                stage: WRITE_FAILURE_STAGE.BUILD,
                statusCode: 400,
                issueCode: 'too-costly',
                message: 'Group group-1 members can only be changed with PATCH'
            }
        },
        {
            name: 'If-None-Match: * with a stored doc fails with 412',
            storedDoc: stored(patient),
            headers: { 'if-none-match': '*' },
            incoming: deepcopy(patient),
            expected: {
                stage: WRITE_FAILURE_STAGE.BUILD,
                statusCode: 412,
                issueCode: 'precondition-failed',
                message: 'Version conflict: If-None-Match: * was provided but resource already exists.'
            }
        },
        {
            name: 'an If-Match that is not the stored version fails with 412',
            storedDoc: stored(patient),
            headers: { 'if-match': 'W/"1"' },
            incoming: deepcopy(patient),
            expected: {
                stage: WRITE_FAILURE_STAGE.BUILD,
                statusCode: 412,
                issueCode: 'precondition-failed',
                message: 'Version conflict: If-Match does not match current resource version. Older version: 2, If-Match: W/"1"'
            }
        },
        {
            name: 'an If-Match against a stored doc with no versionId fails with 412',
            storedDoc: stored(patient, { versionId: null }),
            headers: { 'if-match': 'W/"2"' },
            incoming: deepcopy(patient),
            expected: {
                stage: WRITE_FAILURE_STAGE.BUILD,
                statusCode: 412,
                issueCode: 'precondition-failed',
                message: 'Version conflict: Resource does not have a versionId, but If-Match header was provided. If-Match: W/"2"'
            }
        },
        {
            name: 'If-Match: * with no stored doc fails with 412',
            storedDoc: null,
            headers: { 'if-match': '*' },
            incoming: deepcopy(patient),
            expected: {
                stage: WRITE_FAILURE_STAGE.BUILD,
                statusCode: 412,
                issueCode: 'precondition-failed',
                message: 'Version conflict: Resource does not exist, but If-Match header was provided. If-Match: *'
            }
        },
        {
            name: 'If-Match: * with a stored doc builds the replace',
            storedDoc: stored(patient),
            headers: { 'if-match': '*' },
            incoming: body({ name: [{ family: 'Changed' }] }),
            fields: ['name', 'active'],
            expected: {
                writeMode: 'update',
                candidate: { versionId: '3', isBody: false, name: [{ family: 'Changed' }], active: undefined }
            }
        },
        {
            name: 'a changed body is a replace with the next version and drops the fields the body omits',
            storedDoc: stored(patient),
            headers: { 'if-match': 'W/"2"' },
            incoming: body({ name: [{ family: 'Changed' }] }),
            fields: ['name', 'active'],
            expected: {
                writeMode: 'update',
                candidate: { versionId: '3', isBody: false, name: [{ family: 'Changed' }], active: undefined }
            }
        },
        {
            name: 'a change to only the date is saved',
            storedDoc: stored(composition({ date: '2024-01-01' })),
            headers: {},
            incoming: composition({ date: '2024-02-02' }),
            fields: ['date'],
            expected: {
                writeMode: 'update',
                candidate: { versionId: '3', isBody: false, date: '2024-02-02' }
            }
        },
        {
            name: 'an identical body is a no-op',
            storedDoc: stored(patient),
            headers: {},
            incoming: deepcopy(patient),
            expected: { writeMode: 'update', candidate: null }
        },
        {
            name: 'an identical ClickHouse Group with members is written as the overwritten body with the stored versionId',
            storedDoc: stored(group),
            headers: {},
            incoming: deepcopy(group),
            clickHouseGroup: true,
            fields: ['member', '_uuid'],
            expected: {
                writeMode: 'update',
                candidate: { versionId: '2', isBody: true, member: groupMembers, _uuid: generateUUIDv5('group-1|owner') }
            }
        },
        {
            name: 'an identical Group with members and no post-save handler is a no-op',
            storedDoc: stored(group),
            headers: {},
            incoming: deepcopy(group),
            expected: { writeMode: 'update', candidate: null }
        },
        {
            name: 'no stored doc is built by the InsertBuilder as version 1',
            storedDoc: null,
            headers: {},
            incoming: deepcopy(patient),
            fields: ['name', 'active'],
            expected: {
                writeMode: 'insert',
                candidate: { versionId: '1', isBody: true, name: [{ family: 'Synthetic' }], active: true }
            }
        }
    ])('$name', async ({ storedDoc, headers, incoming, clickHouseGroup, fields, expected }) => {
        const result = await build({ storedDoc, headers, incoming, clickHouseGroup, fields });

        expect(result).toStrictEqual(expected);
    });
});
