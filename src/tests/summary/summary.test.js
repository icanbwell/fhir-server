const { FhirOperationsManager } = require('../../operations/fhirOperationsManager');
const { SummaryOperation } = require('../../operations/summary/summary');
const { GraphOperation } = require('../../operations/graph/graph');
const { FhirLoggingManager } = require('../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../operations/security/scopesValidator');
const { ConfigManager } = require('../../utils/configManager');
const { SummaryHelper } = require('../../operations/summary/summaryHelper');
const { assertTypeEquals } = require('../../utils/assertType');
const { createTestRequest } = require('../common/test.utils');
const { describe, beforeEach, test, expect } = require('@jest/globals');

describe('SummaryOperation Tests', () => {
    let fhirOperationsManager;
    let summaryOperation;
    let graphOperation;
    let fhirLoggingManager;
    let scopesValidator;
    let configManager;
    let summaryHelper;

    beforeEach(() => {
        graphOperation = new GraphOperation();
        fhirLoggingManager = new FhirLoggingManager();
        scopesValidator = new ScopesValidator();
        configManager = new ConfigManager();
        summaryHelper = new SummaryHelper();
        summaryOperation = new SummaryOperation({
            graphOperation,
            fhirLoggingManager,
            scopesValidator,
            configManager,
            summaryHelper
        });
        fhirOperationsManager = new FhirOperationsManager({
            summaryOperation
        });
    });

    test('should handle $summary operation', async () => {
        const request = createTestRequest({
            method: 'GET',
            url: '/4_0_0/Patient/$summary',
            headers: {
                'content-type': 'application/json'
            }
        });

        const response = await fhirOperationsManager.summary([], { req: request }, 'Patient');
        expect(response).toBeDefined();
        expect(response.resourceType).toBe('Bundle');
    });

    test('should handle $summary operation with resource filter', async () => {
        const request = createTestRequest({
            method: 'GET',
            url: '/4_0_0/Patient/$summary?_type=Observation,Condition',
            headers: {
                'content-type': 'application/json'
            }
        });

        const response = await fhirOperationsManager.summary([], { req: request }, 'Patient');
        expect(response).toBeDefined();
        expect(response.resourceType).toBe('Bundle');
    });

    test('should handle $summary operation with non-clinical resources', async () => {
        const request = createTestRequest({
            method: 'GET',
            url: '/4_0_0/Patient/$summary?_includeNonClinicalResources=true',
            headers: {
                'content-type': 'application/json'
            }
        });

        const response = await fhirOperationsManager.summary([], { req: request }, 'Patient');
        expect(response).toBeDefined();
        expect(response.resourceType).toBe('Bundle');
    });

    test('should handle $summary operation with non-clinical resources depth', async () => {
        const request = createTestRequest({
            method: 'GET',
            url: '/4_0_0/Patient/$summary?_includeNonClinicalResources=true&_nonClinicalResourcesDepth=2',
            headers: {
                'content-type': 'application/json'
            }
        });

        const response = await fhirOperationsManager.summary([], { req: request }, 'Patient');
        expect(response).toBeDefined();
        expect(response.resourceType).toBe('Bundle');
    });

    test('should handle $summary operation with invalid non-clinical resources depth', async () => {
        const request = createTestRequest({
            method: 'GET',
            url: '/4_0_0/Patient/$summary?_includeNonClinicalResources=true&_nonClinicalResourcesDepth=5',
            headers: {
                'content-type': 'application/json'
            }
        });

        await expect(fhirOperationsManager.summary([], { req: request }, 'Patient')).rejects.toThrow();
    });
});
