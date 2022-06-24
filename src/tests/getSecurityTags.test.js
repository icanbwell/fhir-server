const supertest = require('supertest');

const {getQueryWithPatientFilter} = require('../operations/common/getSecurityTags');

describe('Security Tags', ()=>{
  test('should return ok',()=> {
    let patientfiltered = getQueryWithPatientFilter(['1234'],{},'AllergyIntolerance')
    let subjectfiltered = getQueryWithPatientFilter(['1234'],{},'Procedure')
    let idfiltered = getQueryWithPatientFilter(['1234'],{},'Patient')
    console.log(patientfiltered)
    console.log(subjectfiltered)
    console.log(idfiltered)
  })
})
