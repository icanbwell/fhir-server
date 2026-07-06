const { describe, test, expect } = require('@jest/globals');
const { AuditEventSizeValidator } = require('../../operations/merge/validators/auditEventSizeValidator');
const { ConfigManager } = require('../../utils/configManager');

function createConfig (maxSizeInBytes) {
    const config = Object.create(ConfigManager.prototype);
    Object.defineProperty(config, 'auditEventMaxSizeBytes', {
        get: () => maxSizeInBytes,
        configurable: true
    });
    return config;
}

function createRequestInfo () {
    return { requestId: 'req-1' };
}

describe('AuditEventSizeValidator', () => {
    test('keeps an AuditEvent under the size limit', async () => {
        const validator = new AuditEventSizeValidator({ configManager: createConfig(1024 * 1024) });
        const resources = [{ resourceType: 'AuditEvent', id: 'a1', meta: { source: 'test' } }];

        const { validatedObjects, preCheckErrors } = await validator.validate({
            requestInfo: createRequestInfo(),
            incomingResources: resources
        });

        expect(validatedObjects).toHaveLength(1);
        expect(preCheckErrors).toHaveLength(0);
    });

    test('rejects an AuditEvent over the size limit as a per-resource error', async () => {
        const validator = new AuditEventSizeValidator({ configManager: createConfig(200) });
        const large = {
            resourceType: 'AuditEvent',
            id: 'big',
            meta: { source: 'test' },
            entity: [{ detail: [{ type: 'x', valueString: 'x'.repeat(5000) }] }]
        };

        const { validatedObjects, preCheckErrors } = await validator.validate({
            requestInfo: createRequestInfo(),
            incomingResources: [large]
        });

        // removed from the valid set...
        expect(validatedObjects).toHaveLength(0);
        // ...and reported as a per-resource error with the too-long issue code
        expect(preCheckErrors).toHaveLength(1);
        expect(preCheckErrors[0].id).toBe('big');
        expect(preCheckErrors[0].resourceType).toBe('AuditEvent');
        expect(preCheckErrors[0].created).toBe(false);
        expect(preCheckErrors[0].issue.code).toBe('too-long');
        expect(preCheckErrors[0].issue.details.text).toMatch(/Payload size too large/);
    });

    test('does not cap non-AuditEvent resources even when large', async () => {
        const validator = new AuditEventSizeValidator({ configManager: createConfig(200) });
        const largePatient = {
            resourceType: 'Patient',
            id: 'p1',
            meta: { source: 'test' },
            text: { div: 'x'.repeat(5000) }
        };

        const { validatedObjects, preCheckErrors } = await validator.validate({
            requestInfo: createRequestInfo(),
            incomingResources: [largePatient]
        });

        expect(validatedObjects).toHaveLength(1);
        expect(preCheckErrors).toHaveLength(0);
    });

    test('keeps valid resources and only removes the oversized ones from a mixed batch', async () => {
        const validator = new AuditEventSizeValidator({ configManager: createConfig(200) });
        const resources = [
            { resourceType: 'AuditEvent', id: 'ok', meta: { source: 'test' } },
            {
                resourceType: 'AuditEvent',
                id: 'big',
                meta: { source: 'test' },
                entity: [{ detail: [{ type: 'x', valueString: 'x'.repeat(5000) }] }]
            }
        ];

        const { validatedObjects, preCheckErrors } = await validator.validate({
            requestInfo: createRequestInfo(),
            incomingResources: resources
        });

        expect(validatedObjects.map((r) => r.id)).toEqual(['ok']);
        expect(preCheckErrors.map((e) => e.id)).toEqual(['big']);
    });
});
