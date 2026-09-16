'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { SearchParametersManager } = require('../../../searchParameters/searchParametersManager');
const { SearchParameterDefinition } = require('../../../searchParameters/searchParameterTypes');

describe('SearchParametersManager.resolveChainTargetType', () => {
    let searchParametersManager;

    beforeEach(() => {
        searchParametersManager = new SearchParametersManager();
    });

    test('returns the sole target type for an untyped chain when only one target is legal', () => {
        // e.g. Observation.patient only ever targets Patient, so `patient.identifier` is unambiguous
        const propertyObj = new SearchParameterDefinition({
            type: 'reference', field: 'subject', target: ['Patient']
        });

        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj, explicitTargetType: undefined
        });

        expect(targetType).toBe('Patient');
    });

    test('returns null for an untyped chain when the reference has multiple legal targets', () => {
        // e.g. Observation.performer targets 6 resource types -- patient.identifier-shaped
        // untyped chain is genuinely ambiguous and must be rejected, not guessed
        const propertyObj = new SearchParameterDefinition({
            type: 'reference', field: 'performer', target: ['Practitioner', 'Organization', 'Patient']
        });

        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj, explicitTargetType: undefined
        });

        expect(targetType).toBeNull();
    });

    test('returns the explicit target type when it is a legal target of the reference', () => {
        const propertyObj = new SearchParameterDefinition({
            type: 'reference', field: 'performer', target: ['Practitioner', 'Organization', 'Patient']
        });

        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj, explicitTargetType: 'Patient'
        });

        expect(targetType).toBe('Patient');
    });

    test('returns null when the explicit target type is not a legal target of the reference', () => {
        const propertyObj = new SearchParameterDefinition({
            type: 'reference', field: 'performer', target: ['Practitioner', 'Organization']
        });

        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj, explicitTargetType: 'Patient'
        });

        expect(targetType).toBeNull();
    });

    test('returns null when the base search parameter is not a reference type', () => {
        const propertyObj = new SearchParameterDefinition({
            type: 'token', field: 'status'
        });

        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj, explicitTargetType: undefined
        });

        expect(targetType).toBeNull();
    });

    test('returns null when propertyObj is undefined', () => {
        const targetType = searchParametersManager.resolveChainTargetType({
            propertyObj: undefined, explicitTargetType: undefined
        });

        expect(targetType).toBeNull();
    });
});
