import React from 'react';
import {Typography, Box} from '@mui/material';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Table from '../partials/Table';
import Period from '../partials/Period';
import Coding from '../partials/Coding';

const Consent = ({resource, admin, index}) => {

    return (
        <Box>
            <Code value={resource.status} name="Status"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.scope} name="Scope"
                             searchParameter=""/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.category} name="Category"
                             searchParameter=""/>
            <Reference references={resource.patient} name="Patient"/>
            <DateTime value={resource.dateTime} name="Date Time"/>
            <Reference references={resource.performer} name="Performer"/>
            <Reference references={resource.organization} name="Organization"/>
            <Reference references={resource.sourceReference} name="Source Reference"/>
            <Table columns={['authority', 'uri']} rows={resource.policy} name="Source Reference"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.policyRule}
                             name="Policy Rule" searchParameter=""/>
            {resource.provision && (
                <>
                    <Typography variant="h4">Provision</Typography>
                    <Code value={resource.provision.type} name="Type"/>
                    <Period periods={resource.provision.period} name="Period"/>

                    {resource.provision.actor && resource.provision.actor.map((actor, index) => (
                        <React.Fragment key={index}>
                            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={actor.role}
                                             name="Actor Role" searchParameter=''/>
                            <Reference references={actor.reference} name="Actor Reference"/>
                        </React.Fragment>
                    ))}

                    <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.provision.action}
                                     name="Action" searchParameter=''/>
                    <Coding resourceType={resource.resourceType} codings={resource.provision.securityLabel}
                            name="SecurityLabel" searchParameter=''/>
                    <Coding resourceType={resource.resourceType} codings={resource.provision.purpose} name="Purpose"
                            searchParameter=''/>
                    <Coding resourceType={resource.resourceType} codings={resource.provision.class} name="Class"
                            searchParameter=''/>
                    <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.provision.code}
                                     name="Code" searchParameter=''/>
                    <Period periods={resource.provision.dataPeriod} name="Data Period"/>

                    {resource.provision.data && resource.provision.data.map((data, index) => (
                        <React.Fragment key={index}>
                            <Code value={data.meaning} name="Meaning"/>
                            <Reference references={data.reference} name="Reference"/>
                        </React.Fragment>
                    ))}
                </>
            )}
        </Box>
    );
};

export default Consent;
