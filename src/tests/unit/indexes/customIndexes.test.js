const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

describe('customIndexes', () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
        jestObj.resetModules();
    });

    function loadCustomIndexes() {
        return require('../../../indexes/customIndexes');
    }

    test('exports a customIndexes object', () => {
        const { customIndexes } = loadCustomIndexes();
        expect(customIndexes).toBeDefined();
        expect(typeof customIndexes).toBe('object');
    });

    test('has a wildcard (*) key for indexes applied to all collections', () => {
        const { customIndexes } = loadCustomIndexes();
        expect(customIndexes['*']).toBeDefined();
        expect(Array.isArray(customIndexes['*'])).toBe(true);
    });

    test('wildcard indexes include meta.source index', () => {
        const { customIndexes } = loadCustomIndexes();
        const metaSourceIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name === 'meta.source_1'
        );
        expect(metaSourceIndex).toBeDefined();
        expect(metaSourceIndex.keys['meta.source']).toBe(1);
        expect(metaSourceIndex.keys._uuid).toBe(1);
    });

    test('meta.source index excludes AuditEvent_4_0_0', () => {
        const { customIndexes } = loadCustomIndexes();
        const metaSourceIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name === 'meta.source_1'
        );
        expect(metaSourceIndex.exclude).toContain('AuditEvent_4_0_0');
    });

    test('meta.source index excludes access-logs collection', () => {
        const { customIndexes } = loadCustomIndexes();
        const metaSourceIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name === 'meta.source_1'
        );
        expect(metaSourceIndex.exclude).toContain('access-logs');
    });

    test('wildcard indexes include security system/code index for Person_4_0_0', () => {
        const { customIndexes } = loadCustomIndexes();
        const securityIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name === 'security.system_code_1'
        );
        expect(securityIndex).toBeDefined();
        expect(securityIndex.keys['meta.security.system']).toBe(1);
        expect(securityIndex.keys['meta.security.code']).toBe(1);
        expect(securityIndex.include).toContain('Person_4_0_0');
    });

    test('generates access tag indexes when ACCESS_TAGS_INDEXED env var is set', () => {
        process.env.ACCESS_TAGS_INDEXED = 'clientA,clientB';
        jestObj.resetModules();
        const { customIndexes } = loadCustomIndexes();

        const accessIndexA = customIndexes['*'].find(
            idx => idx.options && idx.options.name === '_access_clientA_1._uuid_1'
        );
        const accessIndexB = customIndexes['*'].find(
            idx => idx.options && idx.options.name === '_access_clientB_1._uuid_1'
        );

        expect(accessIndexA).toBeDefined();
        expect(accessIndexA.keys['_access.clientA']).toBe(1);
        expect(accessIndexB).toBeDefined();
        expect(accessIndexB.keys['_access.clientB']).toBe(1);
    });

    test('access tag indexes exclude certain collections', () => {
        process.env.ACCESS_TAGS_INDEXED = 'testClient';
        jestObj.resetModules();
        const { customIndexes } = loadCustomIndexes();

        const accessIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name === '_access_testClient_1._uuid_1'
        );

        expect(accessIndex.exclude).toContain('AuditEvent_4_0_0');
        expect(accessIndex.exclude).toContain('Organization_4_0_0');
        expect(accessIndex.exclude).toContain('Person_4_0_0');
        expect(accessIndex.exclude).toContain('Practitioner_4_0_0');
    });

    test('does not generate access tag indexes when ACCESS_TAGS_INDEXED is not set', () => {
        delete process.env.ACCESS_TAGS_INDEXED;
        jestObj.resetModules();
        const { customIndexes } = loadCustomIndexes();

        const accessIndex = customIndexes['*'].find(
            idx => idx.options && idx.options.name && idx.options.name.startsWith('_access_')
        );

        expect(accessIndex).toBeUndefined();
    });

    test('wildcard indexes include subject._uuid index', () => {
        const { customIndexes } = loadCustomIndexes();
        const subjectIndex = customIndexes['*'].find(
            idx => idx.keys && idx.keys['subject._uuid']
        );
        expect(subjectIndex).toBeDefined();
        expect(subjectIndex.keys['subject._uuid']).toBe(1);
    });

    test('each index entry has keys and options properties', () => {
        const { customIndexes } = loadCustomIndexes();
        for (const [collectionKey, indexes] of Object.entries(customIndexes)) {
            for (const index of indexes) {
                expect(index).toHaveProperty('keys');
                expect(index).toHaveProperty('options');
                expect(index.options).toHaveProperty('name');
            }
        }
    });
});
