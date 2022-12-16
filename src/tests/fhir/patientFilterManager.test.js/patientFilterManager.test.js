const {describe, test} = require('@jest/globals');
const {PatientFilterManager} = require('../../../fhir/patientFilterManager');


describe('PatientFilterManager Tests', () => {
  const patientFilterManager = new PatientFilterManager();

  describe('getPatientPropertyForResource', () => {

    test('should return the patient filter property for patient scoped resources', () => {
      Object.entries(patientFilterManager.patientFilterMapping).forEach(entry => {
        const result = patientFilterManager.getPatientPropertyForResource({resourceType: entry[0]});
        expect(result).toEqual(entry[1]);
      });
    });

    test('should return undefined for patient scoped resources', () => {
      const result = patientFilterManager.getPatientPropertyForResource({resourceType: 'Unknown'});
      expect(result).toEqual(undefined);
    });
  });

  describe('canAccessResourceWithPatientScope', () => {

      test('should return true for patient scoped resources', () => {
        Object.keys(patientFilterManager.patientFilterMapping).forEach(key => {
          const result = patientFilterManager.canAccessResourceWithPatientScope({resourceType: key});
          expect(result).toBeTrue();
        });
      });

      test('should return true for resources without patient data', () => {
        patientFilterManager.resourcesWithoutPatientData.forEach(resourceType => {
          const result = patientFilterManager.canAccessResourceWithPatientScope({resourceType: resourceType});
          expect(result).toBeTrue();
        });
      });

      test('should return false for other resourceTypes', () => {
        const result = patientFilterManager.canAccessResourceWithPatientScope({resourceType: 'Unknown'});
        expect(result).toBeFalse();
      });
    }
  );
});
