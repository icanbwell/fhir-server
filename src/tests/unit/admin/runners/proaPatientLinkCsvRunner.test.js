const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { ProaPatientLinkCsvRunner } = require('../../../../admin/runners/proaPatientLinkCsvRunner');
const { PersonMatchManager } = require('../../../../admin/personMatchManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('ProaPatientLinkCsvRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPersonMatchManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockPersonMatchManager = createMockInstance(PersonMatchManager);
        mockPersonMatchManager.personMatchAsync = jestGlobal.fn().mockResolvedValue({
            entry: [{ search: { score: 0.95 } }]
        });

        runner = new ProaPatientLinkCsvRunner({
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            personMatchManager: mockPersonMatchManager,
            batchSize: 100,
            clientSourceAssigningAuthorities: ['clientSAA'],
            skipAlreadyLinked: false,
            getProaPatientClientPersonMatching: false
        });
    });

    describe('convertToCsvFormat', () => {
        test('converts single item array to csv format', () => {
            const data = [{ uuid: 'uuid-1', sourceAssigningAuthority: 'saa1', lastUpdated: '2023-01-01' }];
            const result = runner.convertToCsvFormat(data);
            expect(result.uuid).toBe('uuid-1');
            expect(result.sourceAssigningAuthority).toBe('saa1');
            expect(result.lastUpdated).toBe('2023-01-01');
        });

        test('converts multiple items by joining with comma', () => {
            const data = [
                { uuid: 'uuid-1', sourceAssigningAuthority: 'saa1', lastUpdated: '2023-01-01' },
                { uuid: 'uuid-2', sourceAssigningAuthority: 'saa2', lastUpdated: '2023-02-01' }
            ];
            const result = runner.convertToCsvFormat(data);
            expect(result.uuid).toBe('uuid-1, uuid-2');
            expect(result.sourceAssigningAuthority).toBe('saa1, saa2');
            expect(result.lastUpdated).toBe('2023-01-01, 2023-02-01');
        });

        test('handles empty array', () => {
            const data = [];
            const result = runner.convertToCsvFormat(data);
            expect(result.uuid).toBe('');
            expect(result.sourceAssigningAuthority).toBe('');
            expect(result.lastUpdated).toBe('');
        });
    });

    describe('linkProaPatientData', () => {
        beforeEach(() => {
            runner.proaPatientDataMap.set('patient-uuid-1', {
                uuid: 'patient-uuid-1',
                sourceAssigningAuthority: 'proaSAA',
                lastUpdated: '2023-01-01'
            });
        });

        test('adds person to proaPatientToProaPersonMap when hasProaConnectionType is true', () => {
            runner.linkProaPatientData({
                personUuid: 'person-uuid-1',
                personSourceAssigningAuthority: 'proaSAA',
                personSource: 'some-source',
                hasProaConnectionType: true,
                patientUuid: 'patient-uuid-1'
            });

            expect(runner.proaPatientToProaPersonMap.get('patient-uuid-1')).toContain('person-uuid-1');
        });

        test('adds person to proaPatientToMasterPersonMap when sourceAssigningAuthority is bwell', () => {
            runner.linkProaPatientData({
                personUuid: 'person-uuid-1',
                personSourceAssigningAuthority: 'bwell',
                personSource: 'some-source',
                hasProaConnectionType: false,
                patientUuid: 'patient-uuid-1'
            });

            expect(runner.proaPatientToMasterPersonMap.get('patient-uuid-1')).toContain('person-uuid-1');
        });

        test('adds person to proaPatientToClientPersonMap when source matches clientPersonSource', () => {
            runner.linkProaPatientData({
                personUuid: 'person-uuid-1',
                personSourceAssigningAuthority: 'otherSAA',
                personSource: 'https://www.icanbwell.com/enterprise-person-service',
                hasProaConnectionType: false,
                patientUuid: 'patient-uuid-1'
            });

            expect(runner.proaPatientToClientPersonMap.get('patient-uuid-1')).toContain('person-uuid-1');
        });

        test('adds person to proaPatientToClientPersonMap when sourceAssigningAuthority matches clientSourceAssigningAuthorities', () => {
            runner.linkProaPatientData({
                personUuid: 'person-uuid-1',
                personSourceAssigningAuthority: 'clientSAA',
                personSource: 'other-source',
                hasProaConnectionType: false,
                patientUuid: 'patient-uuid-1'
            });

            expect(runner.proaPatientToClientPersonMap.get('patient-uuid-1')).toContain('person-uuid-1');
        });

        test('adds person to proaPatientToProaPersonMap when sourceAssigningAuthority matches patient SAA', () => {
            runner.linkProaPatientData({
                personUuid: 'person-uuid-1',
                personSourceAssigningAuthority: 'proaSAA',
                personSource: 'other-source',
                hasProaConnectionType: false,
                patientUuid: 'patient-uuid-1'
            });

            expect(runner.proaPatientToProaPersonMap.get('patient-uuid-1')).toContain('person-uuid-1');
        });
    });

    describe('createProaPersonToProaPatientMap', () => {
        test('inverts proaPatientToProaPersonMap', () => {
            runner.proaPatientDataMap.set('patient-1', { uuid: 'patient-1' });
            runner.proaPatientToProaPersonMap.set('patient-1', ['person-A', 'person-B']);

            runner.createProaPersonToProaPatientMap();

            expect(runner.proaPersonToProaPatientMap.get('person-A')).toContain('patient-1');
            expect(runner.proaPersonToProaPatientMap.get('person-B')).toContain('patient-1');
        });

        test('handles empty map', () => {
            runner.createProaPersonToProaPatientMap();
            expect(runner.proaPersonToProaPatientMap.size).toBe(0);
        });

        test('handles multiple patients linked to same person', () => {
            runner.proaPatientDataMap.set('patient-1', { uuid: 'patient-1' });
            runner.proaPatientDataMap.set('patient-2', { uuid: 'patient-2' });
            runner.proaPatientToProaPersonMap.set('patient-1', ['person-A']);
            runner.proaPatientToProaPersonMap.set('patient-2', ['person-A']);

            runner.createProaPersonToProaPatientMap();

            expect(runner.proaPersonToProaPatientMap.get('person-A')).toHaveLength(2);
            expect(runner.proaPersonToProaPatientMap.get('person-A')).toContain('patient-1');
            expect(runner.proaPersonToProaPatientMap.get('person-A')).toContain('patient-2');
        });
    });

    describe('createProaPersonToMasterPersonMap', () => {
        test('inverts masterPersonToProaPersonMap', () => {
            runner.masterPersonToProaPersonMap.set('master-1', ['proa-person-1', 'proa-person-2']);

            runner.createProaPersonToMasterPersonMap();

            expect(runner.proaPersonToMasterPersonMap.get('proa-person-1')).toContain('master-1');
            expect(runner.proaPersonToMasterPersonMap.get('proa-person-2')).toContain('master-1');
        });

        test('handles empty map', () => {
            runner.createProaPersonToMasterPersonMap();
            expect(runner.proaPersonToMasterPersonMap.size).toBe(0);
        });
    });

    describe('handleAllErrorCases', () => {
        beforeEach(() => {
            // Mock write streams
            runner.writeStream = { write: jestGlobal.fn() };
            runner.writeErrorStream = { write: jestGlobal.fn() };
        });

        test('removes patient linked directly to master person', () => {
            runner.proaPatientDataMap.set('patient-1', {
                uuid: 'patient-1', sourceAssigningAuthority: 'saa', lastUpdated: '2023-01-01'
            });
            runner.proaPatientToMasterPersonMap.set('patient-1', ['master-1']);
            runner.personDataMap.set('master-1', {
                uuid: 'master-1', sourceAssigningAuthority: 'bwell', lastUpdated: '2023-01-01'
            });

            runner.handleAllErrorCases();

            expect(runner.proaPatientDataMap.has('patient-1')).toBe(false);
            expect(runner.writeErrorStream.write).toHaveBeenCalled();
        });

        test('does not remove patient with no proa person and no master person', () => {
            runner.proaPatientDataMap.set('patient-1', {
                uuid: 'patient-1', sourceAssigningAuthority: 'saa', lastUpdated: '2023-01-01'
            });
            // No proaPatientToProaPersonMap entry, no masterPerson entry

            runner.handleAllErrorCases();

            // Patient should still be in the map (not enough info to error)
            expect(runner.proaPatientDataMap.has('patient-1')).toBe(true);
        });

        test('removes patient when proa person is not linked to master person', () => {
            runner.proaPatientDataMap.set('patient-1', {
                uuid: 'patient-1', sourceAssigningAuthority: 'saa', lastUpdated: '2023-01-01'
            });
            runner.proaPatientToProaPersonMap.set('patient-1', ['proa-person-1']);
            runner.personDataMap.set('proa-person-1', {
                uuid: 'proa-person-1', sourceAssigningAuthority: 'saa', lastUpdated: '2023-01-01'
            });
            // No proaPersonToMasterPersonMap entry

            runner.handleAllErrorCases();

            expect(runner.proaPatientDataMap.has('patient-1')).toBe(false);
        });
    });
});
