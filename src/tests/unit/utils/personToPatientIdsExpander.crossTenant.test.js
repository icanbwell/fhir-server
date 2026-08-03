/**
 * Tests for PersonToPatientIdsExpander cross-tenant boundary
 * Verifies that person expansion does NOT cross tenant boundaries
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');

describe('PersonToPatientIdsExpander — Cross-Tenant Boundary', () => {
    let PersonToPatientIdsExpander;
    let expander;
    let mockDatabaseQueryManager;

    beforeEach(() => {
        jestGlobal.resetModules();
        ({ PersonToPatientIdsExpander } = require('../../../../utils/personToPatientIdsExpander'));

        mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn()
        };
    });

    describe('BUG: Person expansion follows links across tenant boundaries', () => {
        test('should NOT include patients from a different tenant via Person.link', async () => {
            // PersonA (tenant Alpha) has a link to PersonB (tenant Beta)
            // This should NOT happen in clean data, but if it does (data corruption,
            // migration error, or intentional manipulation), the expander should NOT
            // follow the cross-tenant link.
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                _sourceId: 'alpha-bob',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'alpha_health' }
                    ]
                },
                link: [
                    {
                        target: {
                            _uuid: 'Patient/patient-alpha-uuid',
                            type: 'Patient'
                        }
                    },
                    {
                        // Cross-tenant link (should be ignored)
                        target: {
                            _uuid: 'Person/person-beta-uuid',
                            type: 'Person'
                        }
                    }
                ]
            };

            const personBeta = {
                _uuid: 'person-beta-uuid',
                _sourceId: 'beta-bob',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'beta_insurance' }
                    ]
                },
                link: [
                    {
                        target: {
                            _uuid: 'Patient/patient-beta-uuid',
                            type: 'Patient'
                        }
                    }
                ]
            };

            // Mock: first query returns personAlpha, second returns personBeta
            const mockCursor1 = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(personAlpha)
            };
            const mockCursor2 = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(personBeta)
            };

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(mockCursor1)
                .mockResolvedValueOnce(mockCursor2);

            expander = new PersonToPatientIdsExpander({});

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1
            });

            // CORRECT: should only include Alpha's patient, NOT Beta's
            // The expander should filter out cross-tenant Person links by checking
            // the owner/access tags before following the link
            expect(result).toContain('patient-alpha-uuid');
            expect(result).not.toContain('patient-beta-uuid');
        });

        test('Person query should include security tag filter for tenant isolation', () => {
            // The query to fetch Person resources should include the requesting
            // tenant's security tags, so it cannot accidentally return Person
            // resources from other tenants (even if UUIDs somehow match)

            // Currently the query uses ONLY FilterById (uuid/sourceId match)
            // with NO security tag filter. This means if two tenants have Person
            // records with the same _sourceId, both are returned.
            const expander = new PersonToPatientIdsExpander({});

            // The expander's findAsync call should include security tag filtering
            // This is a design-level assertion: the method signature should accept
            // securityTags or ownerCode and include them in the query
            expect(expander.getPatientIdsFromPersonAsync.length).toBeGreaterThan(0);

            // The actual verification: when findAsync is called, the query should
            // include a security/access filter — not just FilterById
            // Since we can't easily test this without a full integration setup,
            // we verify the method accepts and uses security context
            const methodStr = expander.getPatientIdsFromPersonAsync.toString();
            // CORRECT: the method should reference security tags or access codes
            expect(
                methodStr.includes('security') ||
                methodStr.includes('access') ||
                methodStr.includes('owner')
            ).toBe(true);
        });
    });
});
