const {patients, explanationOfBenefits} = require('../fakedata');

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    patients: async (parent, args, context, info) => { return patients;},
    // eslint-disable-next-line no-unused-vars
    patient: async (parent, args, context, info) => { return patients.filter(x => x.id === args.id)[0];},
  },
  Patient: {
    // eslint-disable-next-line no-unused-vars
    explanationOfBenefit: async (parent, args, context, info) => {
      return explanationOfBenefits.filter(x => x.patient_reference === parent.id);
    },
  },
};
