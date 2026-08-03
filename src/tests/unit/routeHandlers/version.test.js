const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/getImageVersion', () => ({
    getImageVersion: jestObj.fn()
}));

const { handleVersion } = require('../../../routeHandlers/version');
const { getImageVersion } = require('../../../utils/getImageVersion');

describe('version route handler', () => {
    const originalEnv = process.env;
    let mockReq;
    let mockRes;

    beforeEach(() => {
        jestObj.clearAllMocks();
        process.env = { ...originalEnv };

        mockReq = {};
        mockRes = {
            json: jestObj.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('should return version and image when DOCKER_IMAGE is set', () => {
        process.env.DOCKER_IMAGE = 'myregistry/fhir-server:v1.2.3';
        getImageVersion.mockReturnValue('v1.2.3');

        handleVersion(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            version: 'v1.2.3',
            image: 'myregistry/fhir-server:v1.2.3'
        });
    });

    test('should return unknown version and image when DOCKER_IMAGE is not set', () => {
        delete process.env.DOCKER_IMAGE;

        handleVersion(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            version: 'unknown',
            image: 'unknown'
        });
    });

    test('should return unknown version and image when DOCKER_IMAGE is empty string', () => {
        process.env.DOCKER_IMAGE = '';

        handleVersion(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            version: 'unknown',
            image: 'unknown'
        });
    });

    test('should call getImageVersion when DOCKER_IMAGE is set', () => {
        process.env.DOCKER_IMAGE = 'myregistry/fhir-server:latest';
        getImageVersion.mockReturnValue('latest');

        handleVersion(mockReq, mockRes);

        expect(getImageVersion).toHaveBeenCalled();
    });

    test('should not call getImageVersion when DOCKER_IMAGE is not set', () => {
        delete process.env.DOCKER_IMAGE;

        handleVersion(mockReq, mockRes);

        expect(getImageVersion).not.toHaveBeenCalled();
    });

    test('should return the result of res.json', () => {
        process.env.DOCKER_IMAGE = 'myregistry/fhir-server:v1.0.0';
        getImageVersion.mockReturnValue('v1.0.0');

        const result = handleVersion(mockReq, mockRes);

        expect(result).toBe(mockRes);
    });
});
