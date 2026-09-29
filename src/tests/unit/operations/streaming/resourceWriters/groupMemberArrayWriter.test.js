const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

jest.mock('../../../../../operations/common/sentry', () => ({
    captureException: jest.fn()
}));

jest.mock('../../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

const { GroupMemberArrayWriter } = require('../../../../../operations/streaming/resourceWriters/groupMemberArrayWriter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { captureException } = require('../../../../../operations/common/sentry');
const { logError } = require('../../../../../operations/common/logging');
const GroupMemberSerializer = require('../../../../../fhir/serializers/4_0_0/backbone_elements/groupMember');

function createMockInstance (ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

function runTransform (writer, chunk) {
    return new Promise((resolve) => {
        writer._transform(chunk, 'utf8', (err) => resolve(err));
    });
}

function runFlush (writer) {
    return new Promise((resolve) => {
        writer._flush((err) => resolve(err));
    });
}

describe('GroupMemberArrayWriter', () => {
    let mockConfigManager;
    let mockResponse;
    let mockSignal;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigManager = createMockInstance(ConfigManager, {});
        mockResponse = {
            statusCode: 200,
            write: jest.fn(),
            end: jest.fn()
        };
        mockSignal = { aborted: false };
    });

    function createWriter (groupResourceJson) {
        return new GroupMemberArrayWriter({
            groupResourceJson,
            signal: mockSignal,
            highWaterMark: 100,
            configManager: mockConfigManager,
            response: mockResponse
        });
    }

    describe('normal multi-member streaming', () => {
        test('produces valid JSON matching {...groupFields, member: [...]}', async () => {
            const groupResourceJson = { resourceType: 'Group', id: 'group-1', active: true };
            const writer = createWriter(groupResourceJson);
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });

            const member1 = { entity: { reference: 'Patient/1' }, inactive: false };
            const member2 = { entity: { reference: 'Patient/2' }, inactive: true };

            await runTransform(writer, { member: member1 });
            await runTransform(writer, { member: member2 });
            await runFlush(writer);

            const output = pushed.join('');
            const parsed = JSON.parse(output);

            expect(parsed.resourceType).toBe('Group');
            expect(parsed.id).toBe('group-1');
            expect(parsed.active).toBe(true);
            expect(parsed.member).toHaveLength(2);
            expect(parsed.member[0].entity.reference).toBe('Patient/1');
            expect(parsed.member[1].entity.reference).toBe('Patient/2');
            expect(parsed.member[1].inactive).toBe(true);
        });
    });

    describe('zero-member case', () => {
        test('produces valid JSON with an empty member array when no rows are ever streamed', async () => {
            const groupResourceJson = { resourceType: 'Group', id: 'group-empty' };
            const writer = createWriter(groupResourceJson);
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });

            await runFlush(writer);

            const output = pushed.join('');
            const parsed = JSON.parse(output);

            expect(parsed.resourceType).toBe('Group');
            expect(parsed.id).toBe('group-empty');
            expect(parsed.member).toEqual([]);
        });
    });

    describe('GroupMemberSerializer cleaning', () => {
        test('strips unknown/internal fields (e.g. entity._uuid) from a streamed member, matching how the embedded regime serializes Group.member', async () => {
            const groupResourceJson = { resourceType: 'Group', id: 'group-1' };
            const writer = createWriter(groupResourceJson);
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });

            const member = {
                entity: {
                    reference: 'Patient/123',
                    _uuid: 'internal-uuid-should-be-stripped',
                    _sourceAssigningAuthority: 'internal-should-be-stripped'
                },
                period: { start: '2020-01-01T00:00:00Z' },
                inactive: false,
                someUnknownTopLevelField: 'should-be-stripped'
            };

            await runTransform(writer, { member });
            await runFlush(writer);

            const output = pushed.join('');
            const parsed = JSON.parse(output);
            const streamedMember = parsed.member[0];

            expect(streamedMember.entity.reference).toBe('Patient/123');
            expect(streamedMember.entity._uuid).toBeUndefined();
            expect(streamedMember.entity._sourceAssigningAuthority).toBeUndefined();
            expect(streamedMember.period.start).toBe('2020-01-01T00:00:00Z');
            expect(streamedMember.someUnknownTopLevelField).toBeUndefined();
        });
    });

    describe('aborted signal', () => {
        test('_transform skips pushing and just calls back when the signal is already aborted', async () => {
            mockSignal.aborted = true;
            const writer = createWriter({ resourceType: 'Group', id: 'group-1' });
            writer.push = jest.fn();

            const err = await runTransform(writer, { member: { entity: { reference: 'Patient/1' } } });

            expect(err).toBeUndefined();
            expect(writer.push).not.toHaveBeenCalled();
        });
    });

    describe('malformed / edge-case chunks', () => {
        test('a chunk with no .member field is silently skipped', async () => {
            const writer = createWriter({ resourceType: 'Group', id: 'group-1' });
            writer.push = jest.fn();

            const err = await runTransform(writer, { notMember: true });

            expect(err).toBeUndefined();
            expect(writer.push).not.toHaveBeenCalled();
        });

        test('a chunk that throws during serialization is logged/captured and skipped without crashing the stream', async () => {
            const writer = createWriter({ resourceType: 'Group', id: 'group-1' });
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });

            const serializeSpy = jest.spyOn(GroupMemberSerializer, 'serialize').mockImplementationOnce(() => {
                throw new Error('serialization exploded');
            });

            const badMember = { entity: { reference: 'Patient/bad' } };
            const err = await runTransform(writer, { member: badMember });

            expect(err).toBeUndefined();
            expect(writer.push).not.toHaveBeenCalled();
            expect(logError).toHaveBeenCalled();
            expect(captureException).toHaveBeenCalled();

            serializeSpy.mockRestore();

            const goodMember = { entity: { reference: 'Patient/good' } };
            await runTransform(writer, { member: goodMember });
            await runFlush(writer);

            const output = pushed.join('');
            const parsed = JSON.parse(output);
            expect(parsed.member).toHaveLength(1);
            expect(parsed.member[0].entity.reference).toBe('Patient/good');
        });
    });

    describe('constructor validation', () => {
        test('throws if configManager is the wrong type', () => {
            expect(() => new GroupMemberArrayWriter({
                groupResourceJson: { resourceType: 'Group', id: 'g1' },
                signal: mockSignal,
                highWaterMark: 100,
                configManager: {},
                response: mockResponse
            })).toThrow();
        });
    });
});
