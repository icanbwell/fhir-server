'use strict';

/**
 * DCON-5657: processCursorAsync resolves an extended Group's parent match from its
 * GroupMember_4_0_0 roster (it has no inline member[]), only when ENABLE_EXTENDED_GROUP is on.
 */

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({ recordOutboundEverything: jest.fn() }));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

function createCursor (docs = []) {
    let index = 0;
    return {
        hasNext: async () => index < docs.length,
        next: async () => docs[index++]
    };
}

function embeddedGroup (uuid, patientUuid) {
    return {
        resourceType: 'Group',
        _uuid: uuid,
        _sourceId: uuid,
        _sourceAssigningAuthority: 'a',
        member: [{ entity: { _uuid: `Patient/${patientUuid}` } }]
    };
}

function extendedGroup (uuid) {
    return { resourceType: 'Group', _uuid: uuid, _sourceId: uuid, _sourceAssigningAuthority: 'a', _extended: true };
}

describe('EverythingHelper.processCursorAsync - extended Group parent match', () => {
    const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');
    let everythingHelper;
    let mockConfigManager;
    let findGroupUuidsByMemberQueryAsync;
    let logging;

    function cursorArgs (docs, parentUuids = ['p-1']) {
        const parentTracker = new ResourceProccessedTracker();
        parentUuids.forEach((uuid) => parentTracker.add({
            resourceType: 'Patient', _uuid: uuid, _sourceId: uuid, _sourceAssigningAuthority: 'a'
        }));
        return {
            cursor: createCursor(docs),
            requestInfo: { userType: undefined, actor: undefined },
            responseStreamer: undefined,
            parentParsedArgs: { base_version: '4_0_0', _since: undefined },
            bundleEntryIdsProcessedTracker: new ResourceProccessedTracker(),
            resourceIdentifiers: null,
            nonClinicalReferencesExtractor: null,
            parentResourcesProcessedTracker: parentTracker,
            parentLookupField: 'member.entity',
            proxyPatientIds: [],
            parentResourceType: 'Patient',
            everythingRelatedResourceManager: { allowedToBeSent: () => true },
            useUuidProjection: false,
            streamedResources: []
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        logging = require('../../../../operations/common/logging');
        mockConfigManager = { enableExtendedGroup: true, mongoTimeout: 120000 };
        findGroupUuidsByMemberQueryAsync = jest.fn().mockResolvedValue({ groupUuids: [] });

        const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');
        everythingHelper = Object.create(EverythingHelper.prototype);
        everythingHelper.configManager = mockConfigManager;
        everythingHelper.mongoGroupMemberRepository = { findGroupUuidsByMemberQueryAsync };
        everythingHelper.databaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        everythingHelper.base64DataManager = {
            transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        everythingHelper.enrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
    });

    test('emits an extended Group whose roster has a processed parent, via one GroupMember lookup', async () => {
        findGroupUuidsByMemberQueryAsync.mockResolvedValue({ groupUuids: ['g-ext'] });

        const result = await everythingHelper.processCursorAsync(cursorArgs([extendedGroup('g-ext')]));

        expect(result.bundleEntries).toHaveLength(1);
        expect(result.bundleEntries[0].resource._uuid).toBe('g-ext');
        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(1);
        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledWith({
            base_version: '4_0_0',
            query: { groupUuid: 'g-ext', 'member.entity._uuid': { $in: ['Patient/p-1'] } },
            maxTimeMS: 120000
        });
        expect(logging.logError).not.toHaveBeenCalled();
    });

    test('drops an extended Group whose roster has no processed parent', async () => {
        const result = await everythingHelper.processCursorAsync(cursorArgs([extendedGroup('g-other')]));

        expect(result.bundleEntries).toHaveLength(0);
        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(1);
        expect(logging.logError).toHaveBeenCalled();
    });

    test('with ENABLE_EXTENDED_GROUP off the extended Group is dropped and the roster is never read', async () => {
        mockConfigManager.enableExtendedGroup = false;
        findGroupUuidsByMemberQueryAsync.mockResolvedValue({ groupUuids: ['g-ext'] });

        const result = await everythingHelper.processCursorAsync(cursorArgs([extendedGroup('g-ext')]));

        expect(result.bundleEntries).toHaveLength(0);
        expect(findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });

    test('an embedded Group still matches inline and never reads the roster', async () => {
        const result = await everythingHelper.processCursorAsync(cursorArgs([embeddedGroup('g-emb', 'p-1')]));

        expect(result.bundleEntries).toHaveLength(1);
        expect(findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });

    test('a non-extended Group with no matching member is dropped without a roster lookup', async () => {
        const result = await everythingHelper.processCursorAsync(cursorArgs([embeddedGroup('g-foreign', 'other')]));

        expect(result.bundleEntries).toHaveLength(0);
        expect(findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });

    test('a non-Group resource flagged _extended is not resolved through the roster', async () => {
        const result = await everythingHelper.processCursorAsync(cursorArgs([
            { resourceType: 'List', _uuid: 'l-1', _sourceId: 'l1', _sourceAssigningAuthority: 'a', _extended: true }
        ]));

        expect(result.bundleEntries).toHaveLength(0);
        expect(findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });

    test('the roster lookup is memoised per Group within one cursor', async () => {
        findGroupUuidsByMemberQueryAsync.mockResolvedValue({ groupUuids: ['g-ext'] });

        await everythingHelper.processCursorAsync(cursorArgs([extendedGroup('g-ext'), extendedGroup('g-ext')]));

        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(1);
    });

    test('with several parents the roster lookup covers all of them and the Group is emitted once', async () => {
        findGroupUuidsByMemberQueryAsync.mockResolvedValue({ groupUuids: ['g-ext'] });

        const result = await everythingHelper.processCursorAsync(
            cursorArgs([extendedGroup('g-ext'), extendedGroup('g-ext')], ['p-1', 'p-2'])
        );

        expect(result.bundleEntries).toHaveLength(1);
        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(1);
        expect(findGroupUuidsByMemberQueryAsync).toHaveBeenCalledWith({
            base_version: '4_0_0',
            query: { groupUuid: 'g-ext', 'member.entity._uuid': { $in: ['Patient/p-1', 'Patient/p-2'] } },
            maxTimeMS: 120000
        });
    });
});
