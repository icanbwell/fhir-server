const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn()
}));

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn((val, msg) => { if (!val) throw new Error(msg || 'assertion failed'); })
}));

const { AccessHistoryOperation } = require('../../../../operations/accessHistory/accessHistory');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../../../utils/personToPatientIdsExpander');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../operations/security/scopesManager');

describe('AccessHistoryOperation', () => {
    let operation;
    let mockDatabaseQueryFactory;
    let mockPersonToPatientIdsExpander;
    let mockPatientFilterManager;
    let mockAccessHistoryClickHouseRepository;
    let mockConfigManager;
    let mockScopesValidator;
    let mockScopesManager;
    let mockCursor;

    beforeEach(() => {
        mockCursor = {
            hasNext: jest.fn().mockResolvedValue(false),
            next: jest.fn().mockResolvedValue(null)
        };

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockResolvedValue(mockCursor)
        });

        mockPersonToPatientIdsExpander = Object.create(PersonToPatientIdsExpander.prototype);
        mockPersonToPatientIdsExpander.getPatientProxyIdsAsync = jest.fn().mockResolvedValue([
            'person.uuid-person-1',
            'uuid-patient-1'
        ]);

        mockPatientFilterManager = Object.create(PatientFilterManager.prototype);
        mockPatientFilterManager.getAllPatientOrPersonRelatedResources = jest.fn().mockReturnValue([
            'Patient', 'Observation', 'Condition', 'AuditEvent'
        ]);
        mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');

        mockAccessHistoryClickHouseRepository = {
            getAccessHistoryAsync: jest.fn().mockResolvedValue({ rows: [] })
        };

        mockConfigManager = Object.create(ConfigManager.prototype, {
            accessHistoryBatchSize: { value: 100, writable: true },
            accessHistoryMaxParallelProcess: { value: 5, writable: true }
        });

        mockScopesValidator = Object.create(ScopesValidator.prototype);
        mockScopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(true);

        mockScopesManager = Object.create(ScopesManager.prototype);
        mockScopesManager.isAccessToResourceAllowedBySecurityTags = jest.fn().mockReturnValue(true);

        operation = new AccessHistoryOperation({
            databaseQueryFactory: mockDatabaseQueryFactory,
            personToPatientIdsExpander: mockPersonToPatientIdsExpander,
            patientFilterManager: mockPatientFilterManager,
            accessHistoryClickHouseRepository: mockAccessHistoryClickHouseRepository,
            configManager: mockConfigManager,
            scopesValidator: mockScopesValidator,
            scopesManager: mockScopesManager
        });

        // Default: the Person auth check (for non-patient-scoped callers) resolves the target
        // Person; other resource-type lookups (Practitioner, etc. for accessor display names)
        // default to empty unless a test overrides this. Kept resourceType-aware so tests that
        // override this for accessor-detail resolution don't also break the Person auth check.
        operation._findResourcesByUuids = jest.fn().mockImplementation(({ resourceType }) => {
            if (resourceType === 'Person') {
                return Promise.resolve([{ _uuid: 'uuid-person-1', meta: { security: [] } }]);
            }
            return Promise.resolve([]);
        });
    });

    describe('accessHistoryAsync', () => {
        const baseRequestInfo = {
            isUser: false,
            personIdFromJwtToken: null,
            masterPersonIdFromJwtToken: null,
            user: 'tenant-a-service-account',
            scope: 'access/tenant-a.read user/Person.read',
            path: '/Patient/p1/$access-history'
        };

        const baseParsedArgs = {
            id: 'p1',
            base_version: '4_0_0'
        };

        test('throws NotFoundError when ClickHouse repository is null', async () => {
            operation.accessHistoryClickHouseRepository = null;
            await expect(operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('Invalid url');
        });

        test('throws NotFoundError when person UUID cannot be resolved', async () => {
            mockPersonToPatientIdsExpander.getPatientProxyIdsAsync.mockResolvedValue([
                'uuid-patient-1'
            ]); // no proxy prefix entry
            await expect(operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('Person with id p1 not found');
        });

        test('throws ForbiddenError when user requests access history for another person', async () => {
            const requestInfo = {
                isUser: true,
                personIdFromJwtToken: 'different-person-uuid',
                masterPersonIdFromJwtToken: 'also-different',
                path: '/Patient/p1/$access-history'
            };
            await expect(operation.accessHistoryAsync({
                requestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('Access denied');
        });

        test('allows user to access their own person access history', async () => {
            const requestInfo = {
                isUser: true,
                personIdFromJwtToken: 'uuid-person-1',
                masterPersonIdFromJwtToken: null,
                path: '/Patient/p1/$access-history'
            };
            const result = await operation.accessHistoryAsync({
                requestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });
            expect(result.resourceType).toBe('Parameters');
        });

        test('SEC-1584: throws NotFoundError (not ForbiddenError, to avoid leaking existence) when service-account/tenant-scoped caller lacks access to the target Person', async () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(false);
            await expect(operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('Person with id p1 not found');
            expect(mockScopesManager.isAccessToResourceAllowedBySecurityTags).toHaveBeenCalledWith(
                expect.objectContaining({
                    resource: expect.objectContaining({ _uuid: 'uuid-person-1' }),
                    user: baseRequestInfo.user,
                    scope: baseRequestInfo.scope
                })
            );
        });

        test('SEC-1584: allows service-account/tenant-scoped caller whose scope covers the target Person', async () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(true);
            const result = await operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });
            expect(result.resourceType).toBe('Parameters');
        });

        test('SEC-1584: throws NotFoundError when the target Person cannot be found for a tenant-scoped caller', async () => {
            operation._findResourcesByUuids = jest.fn().mockResolvedValue([]);
            await expect(operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('Person with id p1 not found');
        });

        test('returns empty parameters when no ClickHouse rows found', async () => {
            const result = await operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });
            expect(result.resourceType).toBe('Parameters');
            expect(result.parameter).toHaveLength(1);
            expect(result.parameter[0].name).toBe('summary');
        });

        test('returns accessor entries when ClickHouse returns data', async () => {
            mockAccessHistoryClickHouseRepository.getAccessHistoryAsync.mockResolvedValue({
                rows: [
                    {
                        accessor_uuid: 'Practitioner/pract-1',
                        access_count: '5',
                        last_accessed: '2024-06-01T00:00:00Z',
                        purposes: ['http://example.com|TREAT'],
                        entity_resource_type: 'Observation'
                    }
                ]
            });

            // Mock the _findResourcesByUuids to return display info
            operation._findResourcesByUuids = jest.fn().mockResolvedValue([
                { _uuid: 'pract-1', name: [{ given: ['Dr'], family: 'House' }] }
            ]);

            const result = await operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });

            expect(result.resourceType).toBe('Parameters');
            expect(result.parameter.length).toBeGreaterThan(1);
            const accessorParam = result.parameter.find(p => p.name === 'accessor');
            expect(accessorParam).toBeDefined();
            expect(accessorParam.part.find(p => p.name === 'totalCount').valueInteger).toBe(5);
        });

        test('verifies both resource type and AuditEvent scopes', async () => {
            await operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledTimes(2);
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient' })
            );
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'AuditEvent' })
            );
        });

        test('batches entity refs per configManager.accessHistoryBatchSize', async () => {
            // Create 250 entity refs (batchSize = 100, so 3 batches)
            mockConfigManager.accessHistoryBatchSize = 2;
            const manyRefs = ['Patient/uuid-patient-1', 'person.uuid-person-1'];

            // Mock _collectEntityRefs to return many refs
            operation._collectEntityRefs = jest.fn().mockResolvedValue(
                Array.from({ length: 5 }, (_, i) => `Observation/obs-${i}`)
            );

            await operation.accessHistoryAsync({
                requestInfo: baseRequestInfo,
                parsedArgs: baseParsedArgs,
                resourceType: 'Patient'
            });
            // Should call getAccessHistoryAsync 3 times (5 refs / 2 per batch = 3 calls)
            expect(mockAccessHistoryClickHouseRepository.getAccessHistoryAsync).toHaveBeenCalledTimes(3);
        });
    });

    describe('_groupByAccessor', () => {
        test('groups rows by accessor_uuid with correct counts', () => {
            const rows = [
                { accessor_uuid: 'Pract/p1', access_count: '3', last_accessed: '2024-01-01', purposes: [], entity_resource_type: 'Observation' },
                { accessor_uuid: 'Pract/p1', access_count: '2', last_accessed: '2024-02-01', purposes: ['sys|code'], entity_resource_type: 'Condition' },
                { accessor_uuid: 'Pract/p2', access_count: '1', last_accessed: '2024-03-01', purposes: [], entity_resource_type: 'Observation' }
            ];
            const result = operation._groupByAccessor(rows);
            expect(result['Pract/p1'].totalCount).toBe(5);
            expect(result['Pract/p1'].lastAccessed).toBe('2024-02-01');
            expect(result['Pract/p1'].resourceTypes.Observation).toBe(3);
            expect(result['Pract/p1'].resourceTypes.Condition).toBe(2);
            expect(result['Pract/p2'].totalCount).toBe(1);
        });

        test('handles empty rows', () => {
            const result = operation._groupByAccessor([]);
            expect(Object.keys(result)).toHaveLength(0);
        });

        test('handles single row', () => {
            const rows = [
                { accessor_uuid: 'A/1', access_count: '10', last_accessed: '2024-01-01', purposes: ['sys|code1', 'sys|code2'], entity_resource_type: 'Patient' }
            ];
            const result = operation._groupByAccessor(rows);
            expect(result['A/1'].totalCount).toBe(10);
            expect(result['A/1'].purposes.size).toBe(2);
        });

        test('skips null/empty purposes', () => {
            const rows = [
                { accessor_uuid: 'A/1', access_count: '1', last_accessed: '2024-01-01', purposes: [null, '', 'sys|valid'], entity_resource_type: 'Patient' }
            ];
            const result = operation._groupByAccessor(rows);
            expect(result['A/1'].purposes.size).toBe(1);
            expect(result['A/1'].purposes.has('sys|valid')).toBe(true);
        });
    });

    describe('_extractDisplayName', () => {
        test('returns empty string when no name', () => {
            expect(operation._extractDisplayName({})).toBe('');
            expect(operation._extractDisplayName({ name: null })).toBe('');
        });

        test('returns string name directly', () => {
            expect(operation._extractDisplayName({ name: 'Acme Corp' })).toBe('Acme Corp');
        });

        test('returns empty string for non-array non-string name', () => {
            expect(operation._extractDisplayName({ name: 123 })).toBe('');
        });

        test('extracts full human name from array', () => {
            const resource = {
                name: [{ prefix: ['Dr'], given: ['John', 'A'], family: 'Smith' }]
            };
            expect(operation._extractDisplayName(resource)).toBe('Dr John A Smith');
        });

        test('handles name with only family', () => {
            const resource = { name: [{ family: 'Doe' }] };
            expect(operation._extractDisplayName(resource)).toBe('Doe');
        });

        test('falls back to text field when no structured parts', () => {
            const resource = { name: [{ text: 'Full Name Text' }] };
            expect(operation._extractDisplayName(resource)).toBe('Full Name Text');
        });

        test('returns empty string for empty name array', () => {
            expect(operation._extractDisplayName({ name: [] })).toBe('');
        });
    });

    describe('_buildParametersResponse', () => {
        test('builds response with accessor details and organizations', () => {
            const accessorMap = {
                'Patient/person.uuid1': {
                    totalCount: 10,
                    lastAccessed: '2024-01-15T10:00:00Z',
                    purposes: new Set(['http://hl7.org/fhir|TREAT']),
                    resourceTypes: { Observation: 5, Condition: 5 }
                }
            };
            const accessorDetails = {
                'Patient/person.uuid1': {
                    display: 'John Doe',
                    organizations: [{ reference: 'Organization/org1', display: 'Acme', name: 'Acme', sourceId: 'org1' }]
                }
            };
            const result = operation._buildParametersResponse({ accessorMap, accessorDetails });
            expect(result.resourceType).toBe('Parameters');
            expect(result.parameter).toHaveLength(2); // summary + 1 accessor
            const accessor = result.parameter[1];
            expect(accessor.name).toBe('accessor');
            expect(accessor.part.find(p => p.name === 'totalCount').valueInteger).toBe(10);
            expect(accessor.part.find(p => p.name === 'organization')).toBeDefined();
            expect(accessor.part.filter(p => p.name === 'resourceType')).toHaveLength(2);
        });

        test('handles purpose without separator', () => {
            const accessorMap = {
                'Pract/p1': {
                    totalCount: 1,
                    lastAccessed: '2024-01-01',
                    purposes: new Set(['NOPIPE']),
                    resourceTypes: { Patient: 1 }
                }
            };
            const accessorDetails = {};
            const result = operation._buildParametersResponse({ accessorMap, accessorDetails });
            const accessor = result.parameter[1];
            const purposePart = accessor.part.find(p => p.name === 'purposeOfEvent');
            expect(purposePart.valueCoding).toEqual({ code: 'NOPIPE' });
        });

        test('handles purpose with pipe separator', () => {
            const accessorMap = {
                'Pract/p1': {
                    totalCount: 1,
                    lastAccessed: '2024-01-01',
                    purposes: new Set(['http://system|CODE']),
                    resourceTypes: { Patient: 1 }
                }
            };
            const accessorDetails = {};
            const result = operation._buildParametersResponse({ accessorMap, accessorDetails });
            const accessor = result.parameter[1];
            const purposePart = accessor.part.find(p => p.name === 'purposeOfEvent');
            expect(purposePart.valueCoding).toEqual({ system: 'http://system', code: 'CODE' });
        });
    });

    describe('_collectEntityRefs', () => {
        test('returns patient refs when no related resource types have linking fields', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue(null);
            const result = await operation._collectEntityRefs({
                patientUuids: ['uuid-1'],
                base_version: '4_0_0'
            });
            // Should contain Patient/uuid-1 and nothing else since no linking fields
            expect(result).toContain('Patient/uuid-1');
        });

        test('adds entity refs from related resources', async () => {
            let callCount = 0;
            mockCursor.hasNext = jest.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(callCount <= 1);
            });
            mockCursor.next = jest.fn().mockResolvedValue({ _uuid: 'obs-uuid-1' });

            const result = await operation._collectEntityRefs({
                patientUuids: ['uuid-patient-1'],
                base_version: '4_0_0'
            });
            expect(result).toContain('Patient/uuid-patient-1');
        });
    });

    describe('_buildSummaryParameter', () => {
        test('contains generatedAt and windowDays', () => {
            const result = operation._buildSummaryParameter();
            expect(result.name).toBe('summary');
            expect(result.part).toHaveLength(2);
            expect(result.part[0].name).toBe('generatedAt');
            expect(result.part[1].name).toBe('windowDays');
            expect(result.part[1].valueInteger).toBe(90);
        });
    });
});
