// Separate file from binary_with_patient_scope.test.js: the test app is cached per file.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync } = require('./binaryScopeTestHelpers');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

class FlagOffConfigManager extends ConfigManager {
    get enablePatientScopedBinary () {
        return false;
    }
}

describe('Binary patient scope (ENABLE_PATIENT_SCOPED_BINARY off)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('create is rejected for a patient-scoped token, as on main', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new FlagOffConfigManager());
            return c;
        });
        const personUuid = await mergePersonAsync(request);
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary1Resource)
            .set(personScopedHeaders(personUuid));
        expect(resp).toHaveStatusCode(403);
    });
});
