const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock the constants module - fixed to point at src/middleware/fhir/utils/constants.js, which is
// where VERSIONS actually lives; src/constants.js exports no VERSIONS at all (that mismatch was a
// latent bug: VERSIONS['4_0_1'] === undefined['4_0_1'] -> TypeError whenever base_version was
// absent from sanitized_args).
jestObj.mock('../../../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: {
        '4_0_1': '4_0_1',
        '4_0_0': '4_0_0'
    }
}));

// Mock the service module
jestObj.mock('../../../../../middleware/fhir/metadata/metadata.service.js', () => ({
    generateCapabilityStatement: jestObj.fn()
}));

const controller = require('../../../../../middleware/fhir/metadata/metadata.controller.js');
const service = require('../../../../../middleware/fhir/metadata/metadata.service.js');

describe('metadata.controller', () => {
    let req;
    let res;
    let next;
    let profiles;
    let security;
    let statementGenerator;

    beforeEach(() => {
        jestObj.clearAllMocks();
        req = {
            sanitized_args: {},
            protocol: 'http',
            get: jestObj.fn().mockReturnValue('localhost:3000')
        };
        res = {
            status: jestObj.fn().mockReturnThis(),
            json: jestObj.fn().mockReturnThis()
        };
        next = jestObj.fn();
        profiles = { Patient: {} };
        security = [{ url: 'http://example.com' }];
        statementGenerator = jestObj.fn();
    });

    describe('getCapabilityStatement', () => {
        test('returns a middleware function', () => {
            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            expect(typeof middleware).toBe('function');
        });

        test('calls service.generateCapabilityStatement with correct params including default version', async () => {
            service.generateCapabilityStatement.mockResolvedValue({ resourceType: 'CapabilityStatement' });

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(service.generateCapabilityStatement).toHaveBeenCalledWith({
                fhirVersion: '4_0_1',
                profiles,
                security,
                statementGenerator
            });
        });

        test('uses base_version from sanitized_args when provided', async () => {
            req.sanitized_args.base_version = '4_0_0';
            service.generateCapabilityStatement.mockResolvedValue({ resourceType: 'CapabilityStatement' });

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(service.generateCapabilityStatement).toHaveBeenCalledWith({
                fhirVersion: '4_0_0',
                profiles,
                security,
                statementGenerator
            });
        });

        test('responds with 200 and the statement, decorated with implementation.url, on success', async () => {
            const statement = { resourceType: 'CapabilityStatement', status: 'active', implementation: { description: 'FHIR Test Server (R4)' } };
            service.generateCapabilityStatement.mockResolvedValue(statement);

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    implementation: expect.objectContaining({
                        description: 'FHIR Test Server (R4)',
                        url: 'http://localhost:3000/4_0_0'
                    })
                })
            );
        });

        test('sets implementation.url mirroring the alias base path when the request used /fhir/r4', async () => {
            const { FhirBasePath } = require('../../../../../utils/url/fhirBasePath');
            req.fhirBasePath = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });
            req.protocol = 'https';
            req.get = jestObj.fn().mockReturnValue('fhir.icanbwell.com');
            const statement = { resourceType: 'CapabilityStatement', status: 'active', implementation: { description: 'FHIR Test Server (R4)' } };
            service.generateCapabilityStatement.mockResolvedValue(statement);

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    implementation: expect.objectContaining({ url: 'https://fhir.icanbwell.com/fhir/r4' })
                })
            );
        });

        test('handles a statement with no implementation object yet', async () => {
            const statement = { resourceType: 'CapabilityStatement', status: 'active' };
            service.generateCapabilityStatement.mockResolvedValue(statement);

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    implementation: { url: 'http://localhost:3000/4_0_0' }
                })
            );
        });

        test('calls next with error on failure', async () => {
            const error = new Error('Something went wrong');
            service.generateCapabilityStatement.mockRejectedValue(error);

            const middleware = controller.getCapabilityStatement({ profiles, security, statementGenerator });
            await middleware(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });
});
