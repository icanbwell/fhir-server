import React from "react";
import HumanNames from "../partials/HumanNames";
import ContactPoint from "../partials/ContactPoint";
import Code from "../partials/Code";
import DateTime from "../partials/DateTime";
import Address from "../partials/Address";
import Reference from "../partials/Reference";
import ReverseReference from "../partials/ReverseReference";
import {Box, Divider, Link, List, Typography} from '@mui/material';

const Person = ({resource, admin}) => {
    const reverseReferencesList = [
        {target: 'Account', property: 'patient', name: "Account"},
        {target: 'AllergyIntolerance', property: 'patient', name: "AllergyIntolerance"},
        {target: 'Appointment', property: 'patient', name: "Appointment"},
        {target: 'AuditEvent', property: 'patient', name: "AuditEvent"},
        {target: 'CareTeam', property: 'patient', name: "CareTeam"},
        {target: 'Condition', property: 'patient', name: "Condition"},
        {target: 'ChargeItem', property: 'patient', name: "ChargeItem"},
        {target: 'Coverage', property: 'patient', name: "Coverage"},
        {target: 'Encounter', property: 'patient', name: "Encounter"},
        {target: 'Immunization', property: 'patient', name: "Immunization"},
        {target: 'ExplanationOfBenefit', property: 'patient', name: "ExplanationOfBenefit"},
        {target: 'MeasureReport', property: 'patient', name: "MeasureReport"},
        {target: 'MedicationDispense', property: 'patient', name: "MedicationDispense"},
        {target: 'MedicationRequest', property: 'patient', name: "MedicationRequest"},
        {target: 'MedicationStatement', property: 'patient', name: "MedicationStatement"},
        {target: 'Observation', property: 'patient', name: "Observation"},
        {target: 'Person', property: 'link', name: "Person"},
        {target: 'Procedure', property: 'patient', name: "Procedure"},
        {target: 'Schedule', property: 'patient', name: "Schedule"},
        {target: 'ServiceRequest', property: 'patient', name: "ServiceRequest"},
        {target: 'Task', property: 'patient', name: "Task"}
    ];


    return (
        <Box>
            <HumanNames names={resource.name} resourceType={resource.resourceType}/>

            <ContactPoint contacts={resource.telecom} name="Telecom" resourceType={resource.resourceType}/>

            <Code value={resource.gender} name="Gender"/>

            <Code value={resource.active} name="Active"/>

            <DateTime value={resource.birthDate} name="Birth Date"/>

            <Address resourceType={resource.resourceType} addresses={resource.address} name="Address"/>

            <Reference references={[resource.managingOrganization]} name="Managing Organization"/>

            {resource.link && (
                <>
                    <h4>Link</h4>
                    {resource.link.map((link, index) => (
                        <React.Fragment key={index}>
                            <Reference references={link.target} name="Target"/>
                            <Code value={link.assurance} name="Assurance"/>
                        </React.Fragment>
                    ))}
                </>
            )}

            <ReverseReference reverseReferences={[{target: 'AuditEvent', property: 'agent'}]} id={resource.id}
                              name="Audit Event"/>

            <Divider/>
            <Typography variant="h6">Resources in Linked Patient Resources</Typography>
            <List>
                {reverseReferencesList.map((reference, index) =>
                    <ReverseReference
                        key={index}
                        reverseReferences={[{target: reference.target, property: reference.property}]}
                        id={`Patient/person.${resource.id}`}
                        name={reference.name}
                    />
                )}
            </List>

            <Divider/>
            <div>
                <Typography variant="h4">Person Data Graph (in json)</Typography>
                <Link href={`/4_0_0/Person/${resource.id}/$everything?contained=true&_format=json`}>
                    {`/4_0_0/Person/${resource.id}/$everything?contained=true&_format=json`}
                </Link>
            </div>
            {admin &&
                <>
                    <Divider/>
                    <div>
                        <Typography variant="h3">Admin Functions</Typography>
                        <div>
                            <Typography variant="h4">Connected Person-Patient Graph</Typography>
                            <Link href={`/admin/showPersonToPersonLink?bwellPersonId=${resource.id}`}>
                                {`/admin/showPersonToPersonLink?bwellPersonId=${resource.id}`}
                            </Link>
                        </div>
                        <div>
                            <Typography variant="h4">Delete all data</Typography>
                            <Link href={`/admin/deletePersonDataGraph?id=${resource.id}`}>
                                {`/admin/deletePersonDataGraph?id=${resource.id}`}
                            </Link>
                        </div>
                    </div>
                </>
            }
        </Box>
    );
};

export default Person;
