import React from 'react';
import {Typography, Link, Box} from '@mui/material';
import HumanNames from '../partials/HumanNames';
import Code from '../partials/Code';
import ContactPoint from '../partials/ContactPoint';
import NameValue from '../partials/NameValue';
import DateTime from '../partials/DateTime';
import Address from '../partials/Address';
import CodeableConcept from '../partials/CodeableConcept';
import PatientContact from '../partials/PatientContact';
import Reference from '../partials/Reference';
import ReverseReference from '../partials/ReverseReference';

const Patient = ({resource, admin, index}) => {
    const references = [
        'Account', 'AllergyIntolerance', 'Appointment', 'AuditEvent', 'CareTeam',
        'Condition', 'ChargeItem', 'Coverage', 'Encounter', 'Immunization', 'ExplanationOfBenefit',
        'MeasureReport', 'MedicationRequest', 'MedicationStatement', 'Observation', 'Person',
        'Procedure', 'Schedule', 'ServiceRequest', 'Task'
    ];

    return (
        <Box>
            <HumanNames names={resource.name} resourceType={resource.resourceType}/>

            <Code value={resource.active} name="Active"/>

            <ContactPoint contacts={resource.telecom} name="Telecom" resourceType={resource.resourceType}/>

            <Code value={resource.gender} name="Gender"/>

            {resource.birthDate && (
                <Box>
                    <Typography variant="h4">BirthDate</Typography>
                    <Link
                        title={`Search for ${resource.birthDate}`}
                        href={`/4_0_0/${resource.resourceType}?birthdate=${resource.birthDate}`}
                    >
                        {resource.birthDate}
                    </Link>
                </Box>
            )}

            <NameValue value={resource.deceasedBoolean} name="Deceased"/>

            <DateTime value={resource.deceasedDateTime} name="Deceased Date"/>

            <Address addresses={resource.address} name="Address" resourceType={resource.resourceType}/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.maritalStatus}
                             name="Marital Status"/>

            <NameValue value={resource.multipleBirthBoolean} name="Multiple Birth"/>

            <NameValue value={resource.multipleBirthInteger} name="Multiple Birth Sequence"/>

            <PatientContact value={resource.contact} name="Contact" resourceType={resource.resourceType}/>

            {resource.communication && resource.communication.map((comm, index) => (
                <Box key={index}>
                    <CodeableConcept resourceType={resource.resourceType} codeableConcepts={comm.language}
                                     name="Language"/>
                    <NameValue value={comm.preferred} name="Preferred"/>
                </Box>
            ))}

            <Reference references={resource.generalPractitioner} name="General Practitioner"/>

            <Reference references={resource.managingOrganization} name="Managing Organization"/>

            {resource.link && (
                <Box>
                    <Typography variant="h4">Link</Typography>
                    {resource.link.map((link, index) => (
                        <Box key={index}>
                            <Reference references={link.other} name="Other"/>
                            <Code value={link.type} name="Type"/>
                        </Box>
                    ))}
                </Box>
            )}

            {references.map((reference) => (
                <ReverseReference
                    key={reference}
                    reverseReferences={[{target: reference, property: 'patient'}]}
                    id={`Patient/${resource.id}`}
                    name={reference}
                />
            ))}
            <hr/>

            <Box>
                <Typography variant="h4">Patient Data Graph (in json)</Typography>
                <Link href={`/4_0_0/Patient/${resource.id}/$everything?_format=json`}>
                    `/4_0_0/Patient/${resource.id}/$everything?_format=json`
                </Link>
            </Box>

            {admin && (
                <Box>
                    <hr/>
                    <Box>
                        <Typography variant="h3">Admin Functions</Typography>
                        <Box>
                            <Typography variant="h4">Delete all data</Typography>
                            <Link href={`/admin/deletePatientDataGraph?id=${resource.id}`}>
                                `/admin/deletePatientDataGraph?id=${resource.id}`
                            </Link>
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export default Patient;
