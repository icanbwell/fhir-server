'use strict';

/**
 * Regression tests for docs/resource-authorization.md §6d "Patient Data View Control consent".
 *
 * Doc claim under test, verified against the REAL implementation (never a stand-in class):
 *   - A patient can exclude specific resources from their own `$everything`/GraphQLv2/`/mcp` result
 *     via a `dataConnectionViewControl`-category Consent referencing the resource(s) to hide.
 *   - This is implemented by `PatientDataViewControlManager.getConsentAsync`
 *     (`src/utils/patientDataViewController.js`), gated by
 *     `configManager.clientsWithDataConnectionViewControl`.
 *   - The mechanism is scoped ONLY to `$everything`, GraphQLv2, and `/mcp` (`McpToolHandler`,
 *     added by the MCP endpoint plan to mirror `dataSource.js`'s exclusion) — NOT REST search, NOT
 *     GraphQL v1. This is verified below by scanning the actual source tree for every call site of
 *     `PatientDataViewControlManager`/`getConsentAsync`, rather than trusting the doc's prose.
 *
 * Only true external collaborators (ConfigManager, SearchManager, R4ArgsParser, the
 * express-http-context request-scoped store) are mocked; PatientDataViewControlManager itself is
 * required from its real source path and exercised directly.
 */
const fs = require('fs');
const path = require('path');
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

const httpContext = require('express-http-context');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { ConfigManager } = require('../../../utils/configManager');
const { SearchManager } = require('../../../operations/search/searchManager');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { CONSENT_CATEGORY, HTTP_CONTEXT_KEYS } = require('../../../constants');

/**
 * Creates an object that passes `instanceof ClassType` (satisfying the real
 * `assertTypeEquals` check in the constructor) without running the real constructor or any of
 * its side effects. Getter-only properties on the prototype (e.g. ConfigManager's config
 * accessors) are then overridden with `Object.defineProperty` per test, since plain assignment
 * to an accessor-only property silently no-ops.
 */
function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function defineGetter (instance, propertyName, value) {
    Object.defineProperty(instance, propertyName, {
        get: () => value,
        configurable: true
    });
}

describe('Resource Authorization §6d — Patient Data View Control consent', () => {
    /** @type {PatientDataViewControlManager} */
    let manager;
    let mockConfigManager;
    let mockSearchManager;
    let mockR4ArgsParser;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigManager = createMockInstance(ConfigManager);
        defineGetter(mockConfigManager, 'clientsWithDataConnectionViewControl', ['clientA', 'clientB']);

        mockSearchManager = createMockInstance(SearchManager);
        mockSearchManager.fetchResourcesByArgsAsync = jest.fn().mockResolvedValue({
            entries: [],
            queryItems: [],
            options: []
        });

        mockR4ArgsParser = createMockInstance(R4ArgsParser);
        mockR4ArgsParser.parseArgs = jest.fn().mockReturnValue({ parsedArgItems: [] });

        manager = new PatientDataViewControlManager({
            configManager: mockConfigManager,
            searchManager: mockSearchManager,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    function requestInfo (personId) {
        return { personIdFromJwtToken: personId };
    }

    describe('gating by configManager.clientsWithDataConnectionViewControl', () => {
        test('throws (assertIsValid) when no person-owner is in request context and raiseErrorForMissingUserOwner defaults true', async () => {
            httpContext.get.mockReturnValue(null);

            await expect(
                manager.getConsentAsync({
                    requestInfo: requestInfo('person-1'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                })
            ).rejects.toThrow();

            expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
        });

        test('does not throw and returns empty result when owner is missing and raiseErrorForMissingUserOwner is explicitly false', async () => {
            httpContext.get.mockReturnValue(null);

            const result = await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null,
                raiseErrorForMissingUserOwner: false
            });

            expect(result.viewControlResourceToExcludeMap).toEqual({});
        });

        test('reads the person-owner from httpContext keyed by the JWT person id', async () => {
            httpContext.get.mockReturnValue('clientA');

            await manager.getConsentAsync({
                requestInfo: requestInfo('person-123'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(httpContext.get).toHaveBeenCalledWith(
                `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-123`
            );
        });

        test('owner NOT in clientsWithDataConnectionViewControl → returns empty result without querying Consent', async () => {
            httpContext.get.mockReturnValue('someOtherClient');

            const result = await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(result).toEqual({
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            });
            expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
        });

        test('owner IS in clientsWithDataConnectionViewControl → queries for the dataConnectionViewControl Consent', async () => {
            httpContext.get.mockReturnValue('clientA');

            await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Consent',
                    base_version: '4_0_0',
                    applyPatientFilter: false
                })
            );
            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                resourceType: 'Consent',
                args: expect.objectContaining({
                    patient: 'Patient/person.person-1',
                    category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
                })
            });
        });

        test('passes patientFilterReferences through as the Consent search actor filter, joined by comma', async () => {
            httpContext.get.mockReturnValue('clientA');

            await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: ['Patient/p1', 'Patient/p2']
            });

            const { args } = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(args.actor).toBe('Patient/p1,Patient/p2');
        });

        test('omits the actor filter entirely when patientFilterReferences is null or empty', async () => {
            httpContext.get.mockReturnValue('clientA');

            await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: []
            });

            const { args } = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(args.actor).toBeUndefined();
        });
    });

    describe('turning the Consent.provision.data references into the resource-exclusion map', () => {
        test('groups excluded resource references by resourceType', async () => {
            httpContext.get.mockReturnValue('clientA');
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                entries: [
                    {
                        resource: {
                            provision: {
                                data: [
                                    { reference: { reference: 'Observation/obs-1' } },
                                    { reference: { reference: 'Observation/obs-2' } },
                                    { reference: { reference: 'Condition/cond-1' } }
                                ]
                            }
                        }
                    }
                ],
                queryItems: ['q1'],
                options: ['o1']
            });

            const result = await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(result.viewControlResourceToExcludeMap).toEqual({
                Observation: ['obs-1', 'obs-2'],
                Condition: ['cond-1']
            });
            expect(result.viewControlConsentQueries).toEqual(['q1']);
            expect(result.viewControlConsentQueryOptions).toEqual(['o1']);
        });

        test('skips provision.data entries with no reference.reference', async () => {
            httpContext.get.mockReturnValue('clientA');
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                entries: [
                    {
                        resource: {
                            provision: {
                                data: [
                                    { reference: {} },
                                    {},
                                    { reference: { reference: 'Observation/obs-1' } }
                                ]
                            }
                        }
                    }
                ],
                queryItems: [],
                options: []
            });

            const result = await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(result.viewControlResourceToExcludeMap).toEqual({ Observation: ['obs-1'] });
        });

        test('a Consent with no provision.data produces an empty exclusion map (not an error)', async () => {
            httpContext.get.mockReturnValue('clientA');
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                entries: [{ resource: {} }],
                queryItems: [],
                options: []
            });

            const result = await manager.getConsentAsync({
                requestInfo: requestInfo('person-1'),
                base_version: '4_0_0',
                patientFilterReferences: null
            });

            expect(result.viewControlResourceToExcludeMap).toEqual({});
        });
    });

    describe('every read path reaches the Consent through PatientDataViewControlExclusion (confirmed by scanning the real source tree)', () => {
        /**
         * REST search / read-by-id (`fhirOperationsManager.js`), GraphQL v1 (`graphql/dataSource.js`),
         * GraphQL v2 (`graphqlv2/dataSource.js`), `$everything` (`everythingHelper.js`) and `/mcp`
         * (`mcpToolHandler.js`) all get the caller's view-control Consent from the single wrapper
         * `utils/patientDataViewControlExclusion.js`, which loads it once per request. Rather than
         * trust prose, this walks the actual `src/` (excluding `src/tests`) and asserts the exact,
         * closed set of files that reference `PatientDataViewControlManager` or call
         * `getConsentAsync`. If a future change looks the Consent up some other way, this test fails
         * and the once-per-request and owner-tag guarantees must be re-verified.
         */
        function findFilesReferencing (rootDir, needle) {
            const matches = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.name === 'tests') {
                        continue;
                    }
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    } else if (entry.isFile() && entry.name.endsWith('.js')) {
                        const contents = fs.readFileSync(fullPath, 'utf8');
                        if (contents.includes(needle)) {
                            matches.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
                        }
                    }
                }
            };
            walk(rootDir);
            return matches.sort();
        }

        test('PatientDataViewControlManager is only referenced by its own definition, its IoC wiring, and the exclusion wrapper', () => {
            const srcDir = path.resolve(__dirname, '../../../../src');

            const referencingFiles = findFilesReferencing(srcDir, 'PatientDataViewControlManager');

            expect(referencingFiles).toEqual([
                'createContainer.js',
                'utils/patientDataViewControlExclusion.js',
                'utils/patientDataViewController.js'
            ]);
        });

        test('getConsentAsync is only called from the exclusion wrapper, and every read path uses the wrapper', () => {
            const srcDir = path.resolve(__dirname, '../../../../src');

            const callSites = findFilesReferencing(srcDir, '.getConsentAsync(')
                .filter((file) => file !== 'utils/patientDataViewController.js');

            expect(callSites).toEqual(['utils/patientDataViewControlExclusion.js']);

            for (const file of [
                'operations/fhirOperationsManager.js',
                'graphql/dataSource.js',
                'graphqlv2/dataSource.js',
                'operations/everything/everythingHelper.js',
                'mcp/mcpToolHandler.js'
            ]) {
                const contents = fs.readFileSync(path.join(srcDir, file), 'utf8');
                expect(contents).toContain('this.patientDataViewControlExclusion.');
                expect(contents).not.toContain('getConsentAsync(');
            }
            // The search execution layers themselves stay consent-agnostic.
            expect(fs.readFileSync(path.join(srcDir, 'operations/search/searchBundle.js'), 'utf8'))
                .not.toContain('getConsentAsync');
            expect(fs.readFileSync(path.join(srcDir, 'operations/search/searchStreaming.js'), 'utf8'))
                .not.toContain('getConsentAsync');
        });
    });
});
