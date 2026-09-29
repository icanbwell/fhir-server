'use strict';

/**
 * Regression tests for docs/resource-authorization.md §9 "Sensitivity classification".
 *
 * Doc claims under test, verified against the REAL implementations (never a stand-in class):
 *   1. Confidentiality restriction tag (meta.security, system
 *      http://terminology.hl7.org/CodeSystem/v3-Confidentiality, code R; RESOURCE_RESTRICTION_TAG
 *      in src/constants.js) is excluded unconditionally for every patient-scoped (isUser) caller:
 *        - read side: PatientQueryCreator.applyCommonPatientFilters
 *          (src/operations/common/patientQueryCreator.js) ANDs an exclusion filter onto the query.
 *        - write side: ScopesValidator.isAccessToResourceRestrictedForPatientScope
 *          (src/operations/security/scopesValidator.js) throws ForbiddenError.
 *   2. The `unclassified` sensitivity tag (meta.security, system .../sensitivity-category, code
 *      unclassified; SENSITIVE_CATEGORY in src/constants.js) is auto-added on write by
 *      UnclassifiedSensitivityTagHandler (src/preSaveHandlers/handlers/unclassifiedSensitivityTagHandler.js)
 *      for resource types in configManager.resourceTypesForUnclassifiedTagging, EXCEPT:
 *        (a) when the x-suppress-unclassified-tag header / PreSaveOptions.suppressUnclassifiedTag
 *            option is set,
 *        (b) when the resource type is not in the configured list,
 *        (c) it never double-adds the tag if the resource already carries one (or collapses
 *            duplicates down to one canonical tag if it somehow carries more than one).
 *
 * Only true external collaborators (ConfigManager) are mocked; the classes under test
 * (PatientQueryCreator, ScopesValidator, UnclassifiedSensitivityTagHandler, PreSaveOptions) are
 * required from their real source paths and exercised directly, including real FHIR resource/
 * Meta/Coding classes for the "real Resource instance" branch of the handler.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { PatientQueryCreator } = require('../../../operations/common/patientQueryCreator');
const { ScopesValidator } = require('../../../operations/security/scopesValidator');
const { UnclassifiedSensitivityTagHandler } = require('../../../preSaveHandlers/handlers/unclassifiedSensitivityTagHandler');
const { PreSaveOptions } = require('../../../preSaveHandlers/preSaveOptions');
const { RESOURCE_RESTRICTION_TAG, SENSITIVE_CATEGORY } = require('../../../constants');
const { generateUUIDv5 } = require('../../../utils/uid.util');

const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../operations/common/fhirLoggingManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DelegatedAccessScopeManager } = require('../../../operations/security/delegatedAccessScopeManager');

const Basic = require('../../../fhir/classes/4_0_0/resources/basic');
const Meta = require('../../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

/**
 * Creates an object that passes `instanceof ClassType` (satisfying the real `assertTypeEquals`
 * check baked into these constructors) without running the real constructor. Used only for
 * collaborators whose own behavior is irrelevant to the method under test in a given block.
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

describe('Resource Authorization §9 — Sensitivity classification', () => {
    describe('constants match the doc-cited system/code values', () => {
        test('RESOURCE_RESTRICTION_TAG is the v3-Confidentiality "R" code', () => {
            expect(RESOURCE_RESTRICTION_TAG).toEqual({
                SYSTEM: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
                CODE: 'R'
            });
        });

        test('SENSITIVE_CATEGORY has the unclassified code and suppress header name', () => {
            expect(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE).toBe('unclassified');
            expect(SENSITIVE_CATEGORY.SUPPRESS_HEADER).toBe('x-suppress-unclassified-tag');
        });
    });

    describe('Confidentiality restriction tag — read side (PatientQueryCreator.applyCommonPatientFilters)', () => {
        /** @type {PatientQueryCreator} */
        let patientQueryCreator;

        beforeEach(() => {
            patientQueryCreator = new PatientQueryCreator({
                patientFilterManager: createMockInstance(PatientFilterManager),
                r4SearchQueryCreator: createMockInstance(R4SearchQueryCreator),
                r4ArgsParser: createMockInstance(R4ArgsParser)
            });
        });

        test('ANDs a $not/$elemMatch exclusion for confidentiality-R onto an empty query', () => {
            const result = patientQueryCreator.applyCommonPatientFilters({ query: {} });

            expect(result.$and).toContainEqual({
                'meta.security': {
                    $not: {
                        $elemMatch: {
                            system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                            code: RESOURCE_RESTRICTION_TAG.CODE
                        }
                    }
                }
            });
        });

        test('appends to (rather than replaces) an existing $and array on the query', () => {
            const existingClause = { subject: 'Patient/123' };
            const result = patientQueryCreator.applyCommonPatientFilters({
                query: { $and: [existingClause] }
            });

            expect(result.$and).toHaveLength(2);
            expect(result.$and[0]).toBe(existingClause);
            expect(result.$and[1]).toEqual({
                'meta.security': {
                    $not: {
                        $elemMatch: {
                            system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                            code: RESOURCE_RESTRICTION_TAG.CODE
                        }
                    }
                }
            });
        });
    });

    describe('Confidentiality restriction tag — write side (ScopesValidator.isAccessToResourceRestrictedForPatientScope)', () => {
        /** @type {ScopesValidator} */
        let scopesValidator;

        beforeEach(() => {
            scopesValidator = new ScopesValidator({
                scopesManager: createMockInstance(ScopesManager),
                fhirLoggingManager: createMockInstance(FhirLoggingManager),
                configManager: createMockInstance(ConfigManager),
                patientScopeManager: createMockInstance(PatientScopeManager),
                preSaveManager: createMockInstance(PreSaveManager),
                delegatedAccessScopeManager: createMockInstance(DelegatedAccessScopeManager)
            });
        });

        function restrictedResource (overrides = {}) {
            return {
                resourceType: 'Observation',
                id: 'obs-1',
                meta: {
                    security: [
                        { system: RESOURCE_RESTRICTION_TAG.SYSTEM, code: RESOURCE_RESTRICTION_TAG.CODE }
                    ]
                },
                ...overrides
            };
        }

        test('throws a 403 ForbiddenError for a patient-scoped (isUser) caller against a confidentiality-R resource', () => {
            const requestInfo = { isUser: true, user: 'patient-1', scope: 'patient/Observation.read' };

            // Note: httpErrors.js's error subclasses (ForbiddenError etc.) all share a base
            // ServerError constructor that unconditionally does
            // `Object.setPrototypeOf(this, ServerError.prototype)`, which erases the subclass
            // identity for `instanceof` purposes (every instance reports as a plain ServerError).
            // So we assert via statusCode/message rather than `.toThrow(ForbiddenError)`, matching
            // the convention used elsewhere in this suite (e.g. 02_ownerTags.test.js).
            let thrown;
            try {
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo,
                    resource: restrictedResource(),
                    accessRequested: 'read'
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeDefined();
            expect(thrown.statusCode).toBe(403);
            expect(thrown.message).toMatch(/has no read access to resource Observation with id obs-1/);
        });

        test('does NOT throw for a patient-scoped caller against a resource without the restriction tag', () => {
            const requestInfo = { isUser: true, user: 'patient-1', scope: 'patient/Observation.read' };
            const unrestricted = restrictedResource({
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            });

            expect(() =>
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo,
                    resource: unrestricted,
                    accessRequested: 'read'
                })
            ).not.toThrow();
        });

        test('does NOT throw for a non-patient-scoped caller (isUser false) even against a confidentiality-R resource', () => {
            // Per the doc, this exclusion applies "for every patient-scoped (isUser) caller" —
            // it is not a blanket restriction independent of caller type.
            const requestInfo = { isUser: false, user: 'service-account', scope: 'access/tenant-a.read' };

            expect(() =>
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo,
                    resource: restrictedResource(),
                    accessRequested: 'read'
                })
            ).not.toThrow();
        });

        test('does NOT throw when the resource has no meta at all (defensive optional-chaining)', () => {
            const requestInfo = { isUser: true, user: 'patient-1', scope: 'patient/Observation.read' };

            expect(() =>
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo,
                    resource: { resourceType: 'Observation', id: 'obs-2' },
                    accessRequested: 'read'
                })
            ).not.toThrow();
        });
    });

    describe('unclassified sensitivity tag — auto-added on write by UnclassifiedSensitivityTagHandler', () => {
        /** @type {UnclassifiedSensitivityTagHandler} */
        let handler;
        let mockConfigManager;

        function configuredFor (resourceTypes) {
            mockConfigManager = createMockInstance(ConfigManager);
            defineGetter(mockConfigManager, 'resourceTypesForUnclassifiedTagging', new Set(resourceTypes));
            return mockConfigManager;
        }

        function isUnclassifiedTag (tag) {
            return tag.system === SENSITIVE_CATEGORY.SYSTEM && tag.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE;
        }

        beforeEach(() => {
            handler = new UnclassifiedSensitivityTagHandler({ configManager: configuredFor(['Observation']) });
        });

        test('(1) adds the unclassified tag for a configured resource type when no suppress header/option is set', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };

            const result = await handler.preSaveAsync({ resource, options: {} });

            const unclassifiedTags = result.meta.security.filter(isUnclassifiedTag);
            expect(unclassifiedTags).toHaveLength(1);
        });

        test('(2a) does NOT add the tag when options.suppressUnclassifiedTag is set', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };

            const result = await handler.preSaveAsync({
                resource,
                options: new PreSaveOptions({ suppressUnclassifiedTag: true })
            });

            expect(result.meta.security.some(isUnclassifiedTag)).toBe(false);
        });

        test('(2a) the x-suppress-unclassified-tag header, via the real PreSaveOptions.fromRequestInfo, suppresses the tag end-to-end', async () => {
            const options = PreSaveOptions.fromRequestInfo({
                headers: { [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' }
            });
            expect(options.suppressUnclassifiedTag).toBe(true);

            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };

            const result = await handler.preSaveAsync({ resource, options });

            expect(result.meta.security.some(isUnclassifiedTag)).toBe(false);
        });

        test('(3) does NOT add the tag for a resource type not in the configured list', async () => {
            handler = new UnclassifiedSensitivityTagHandler({ configManager: configuredFor(['Patient']) });
            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };

            const result = await handler.preSaveAsync({ resource, options: {} });

            expect(result.meta.security.some(isUnclassifiedTag)).toBe(false);
        });

        test('(4) does NOT double-add the tag when the resource is already tagged unclassified', async () => {
            const existingTag = {
                id: generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`),
                system: SENSITIVE_CATEGORY.SYSTEM,
                code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            };
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                        existingTag
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource, options: {} });

            expect(result.meta.security.filter(isUnclassifiedTag)).toHaveLength(1);
        });

        test('(4) collapses duplicate unclassified tags down to a single canonical one, keyed by generateUUIDv5', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { id: 'stale-id-1', system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE },
                        { id: 'stale-id-2', system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource, options: {} });

            const unclassifiedTags = result.meta.security.filter(isUnclassifiedTag);
            expect(unclassifiedTags).toHaveLength(1);
            expect(unclassifiedTags[0].id).toBe(
                generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`)
            );
        });

        test('calling preSaveAsync twice in a row is idempotent (no accumulation of tags)', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };

            const once = await handler.preSaveAsync({ resource, options: {} });
            const twice = await handler.preSaveAsync({ resource: once, options: {} });

            expect(twice.meta.security.filter(isUnclassifiedTag)).toHaveLength(1);
        });

        test('guard: does nothing when the resource has no meta.security array at all (even for a configured resource type)', async () => {
            const resource = { resourceType: 'Observation', meta: {} };

            const result = await handler.preSaveAsync({ resource, options: {} });

            expect(result.meta.security).toBeUndefined();
        });

        test('pushes a real Coding instance (not a plain object) when the resource is a real FHIR Resource instance', async () => {
            const resource = new Basic({
                id: 'basic-1',
                meta: new Meta({
                    security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }]
                })
            });
            expect(resource).toBeInstanceOf(Resource);
            handler = new UnclassifiedSensitivityTagHandler({ configManager: configuredFor(['Basic']) });

            const result = await handler.preSaveAsync({ resource, options: {} });

            const unclassifiedTag = result.meta.security.find(isUnclassifiedTag);
            expect(unclassifiedTag).toBeInstanceOf(Coding);
        });

        test('pushes a plain object (not a Coding instance) when the resource is a plain object (fast-merge flow)', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
            };
            expect(resource).not.toBeInstanceOf(Resource);

            const result = await handler.preSaveAsync({ resource, options: {} });

            const unclassifiedTag = result.meta.security.find(isUnclassifiedTag);
            expect(unclassifiedTag).not.toBeInstanceOf(Coding);
            expect(unclassifiedTag).toEqual({
                id: generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`),
                system: SENSITIVE_CATEGORY.SYSTEM,
                code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            });
        });
    });
});
