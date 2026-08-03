'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jestObj.fn((input) => `uuidv5-${input}`)
}));

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => class Resource {});

jestObj.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return class Coding {
        constructor(props) {
            Object.assign(this, props);
        }
    };
});

const { SourceAssigningAuthorityColumnHandler } = require('../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('SourceAssigningAuthorityColumnHandler', () => {
    const makeHandler = (codingIdResourceTypes = ['Patient', 'Observation']) => {
        return new SourceAssigningAuthorityColumnHandler({
            configManager: {
                preSaveCodingIdUpdateResources: codingIdResourceTypes
            }
        });
    };

    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('constructor', () => {
        test('creates codingIdResourceTypes Set from config', () => {
            const handler = makeHandler(['Patient', 'Observation']);
            expect(handler.codingIdResourceTypes).toBeInstanceOf(Set);
            expect(handler.codingIdResourceTypes.has('Patient')).toBe(true);
            expect(handler.codingIdResourceTypes.has('Observation')).toBe(true);
        });

        test('handles empty array', () => {
            const handler = makeHandler([]);
            expect(handler.codingIdResourceTypes.size).toBe(0);
        });
    });

    describe('preSaveAsync - extracts sourceAssigningAuthority tag', () => {
        test('extracts sourceAssigningAuthority from existing security tag', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('bwell');
        });

        test('uses first sourceAssigningAuthority when multiple exist', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'first' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'second' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('first');
        });

        test('deduplicates sourceAssigningAuthority codes', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('bwell');
        });

        test('does not add new security tag when sourceAssigningAuthority already exists', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'some_owner' }
                    ]
                }
            };
            await handler.preSaveAsync({ resource });
            const saaTags = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            // Should only have the original one, not a new one
            expect(saaTags).toHaveLength(1);
        });
    });

    describe('preSaveAsync - falls back to owner tag', () => {
        test('falls back to owner tag when sourceAssigningAuthority tag is missing', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'org-abc' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('org-abc');
        });

        test('adds sourceAssigningAuthority security tag when falling back to owner (plain object)', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'org-abc' }
                    ]
                }
            };
            await handler.preSaveAsync({ resource });
            const saaTags = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            expect(saaTags).toHaveLength(1);
            expect(saaTags[0].code).toBe('org-abc');
        });

        test('adds Coding instance when falling back to owner on Resource instance', async () => {
            const handler = makeHandler();
            const resource = new Resource();
            resource.resourceType = 'Patient';
            resource.meta = {
                security: [
                    { system: SecurityTagSystem.owner, code: 'org-abc' }
                ]
            };
            await handler.preSaveAsync({ resource });
            const saaTags = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            expect(saaTags).toHaveLength(1);
            expect(saaTags[0].system).toBe(SecurityTagSystem.sourceAssigningAuthority);
            expect(saaTags[0].code).toBe('org-abc');
        });

        test('uses buildSourceAssigningAuthorityTag for plain objects with id for configured types', async () => {
            const handler = makeHandler(['Patient']);
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'org-abc' }
                    ]
                }
            };
            await handler.preSaveAsync({ resource });
            const saaTag = resource.meta.security.find(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            expect(saaTag.id).toBe(`uuidv5-${SecurityTagSystem.sourceAssigningAuthority}|org-abc`);
        });

        test('uses first owner code when multiple owners exist', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'first_owner' },
                        { system: SecurityTagSystem.owner, code: 'second_owner' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('first_owner');
        });

        test('deduplicates owner codes when falling back', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'org-abc' },
                        { system: SecurityTagSystem.owner, code: 'org-abc' }
                    ]
                }
            };
            await handler.preSaveAsync({ resource });
            expect(resource._sourceAssigningAuthority).toBe('org-abc');
        });
    });

    describe('preSaveAsync - sets _sourceAssigningAuthority field', () => {
        test('sets _sourceAssigningAuthority when not previously set', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('bwell');
        });

        test('updates _sourceAssigningAuthority when it differs from tag value', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'old_value',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'new_value' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('new_value');
        });

        test('does not overwrite _sourceAssigningAuthority if already correct', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'bwell',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBe('bwell');
        });
    });

    describe('preSaveAsync - no applicable tags', () => {
        test('does nothing when meta is missing', async () => {
            const handler = makeHandler();
            const resource = { resourceType: 'Patient' };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBeUndefined();
        });

        test('does nothing when meta is null', async () => {
            const handler = makeHandler();
            const resource = { resourceType: 'Patient', meta: null };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBeUndefined();
        });

        test('does nothing when security array is empty', async () => {
            const handler = makeHandler();
            const resource = { resourceType: 'Patient', meta: { security: [] } };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBeUndefined();
        });

        test('does nothing when security is null', async () => {
            const handler = makeHandler();
            const resource = { resourceType: 'Patient', meta: { security: null } };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBeUndefined();
        });

        test('does nothing when no sourceAssigningAuthority or owner tags exist', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_a' },
                        { system: SecurityTagSystem.vendor, code: 'vendor_x' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._sourceAssigningAuthority).toBeUndefined();
        });
    });

    describe('preSaveAsync - return value', () => {
        test('returns the same resource reference', async () => {
            const handler = makeHandler();
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result).toBe(resource);
        });
    });

    describe('buildSourceAssigningAuthorityTag', () => {
        test('includes id for configured resource types', () => {
            const handler = makeHandler(['Patient']);
            const tag = handler.buildSourceAssigningAuthorityTag('Patient', 'bwell');
            expect(tag.id).toBe(`uuidv5-${SecurityTagSystem.sourceAssigningAuthority}|bwell`);
            expect(tag.system).toBe(SecurityTagSystem.sourceAssigningAuthority);
            expect(tag.code).toBe('bwell');
        });

        test('includes id when Resource is in the config list', () => {
            const handler = makeHandler(['Resource']);
            const tag = handler.buildSourceAssigningAuthorityTag('AnyType', 'code-1');
            expect(tag.id).toBeDefined();
            expect(tag.id).toBe(`uuidv5-${SecurityTagSystem.sourceAssigningAuthority}|code-1`);
        });

        test('does not include id for non-configured resource types', () => {
            const handler = makeHandler(['Patient']);
            const tag = handler.buildSourceAssigningAuthorityTag('Observation', 'bwell');
            expect(tag.id).toBeUndefined();
        });

        test('produces correct system and code', () => {
            const handler = makeHandler([]);
            const tag = handler.buildSourceAssigningAuthorityTag('Patient', 'my-authority');
            expect(tag.system).toBe(SecurityTagSystem.sourceAssigningAuthority);
            expect(tag.code).toBe('my-authority');
        });

        test('calls generateUUIDv5 with correct input for configured types', () => {
            const handler = makeHandler(['Patient']);
            handler.buildSourceAssigningAuthorityTag('Patient', 'org-x');
            expect(generateUUIDv5).toHaveBeenCalledWith(
                `${SecurityTagSystem.sourceAssigningAuthority}|org-x`
            );
        });

        test('does not call generateUUIDv5 for unconfigured types', () => {
            const handler = makeHandler(['Patient']);
            handler.buildSourceAssigningAuthorityTag('Encounter', 'org-x');
            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('tag has correct structure with id', () => {
            const handler = makeHandler(['Patient']);
            const tag = handler.buildSourceAssigningAuthorityTag('Patient', 'bwell');
            expect(Object.keys(tag).sort()).toEqual(['code', 'id', 'system']);
        });

        test('tag has correct structure without id', () => {
            const handler = makeHandler([]);
            const tag = handler.buildSourceAssigningAuthorityTag('Patient', 'bwell');
            expect(Object.keys(tag).sort()).toEqual(['code', 'system']);
        });

        test('produces deterministic id (same input gives same output)', () => {
            const handler = makeHandler(['Patient']);
            const tag1 = handler.buildSourceAssigningAuthorityTag('Patient', 'bwell');
            const tag2 = handler.buildSourceAssigningAuthorityTag('Patient', 'bwell');
            expect(tag1.id).toBe(tag2.id);
        });

        test('produces different ids for different codes', () => {
            const handler = makeHandler(['Patient']);
            const tag1 = handler.buildSourceAssigningAuthorityTag('Patient', 'code-a');
            const tag2 = handler.buildSourceAssigningAuthorityTag('Patient', 'code-b');
            expect(tag1.id).not.toBe(tag2.id);
        });
    });
});
