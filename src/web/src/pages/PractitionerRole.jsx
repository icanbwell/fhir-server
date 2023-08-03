import React from 'react';
import {Typography} from '@mui/material';
import Reference from '../partials/Reference';
import ReverseReference from '../partials/ReverseReference';
import CodeableConcept from '../partials/CodeableConcept';

function PractitionerRole({resource}) {
    const {practitioner, organization, location, id, healthcareService, resourceType, specialty} = resource;
    return (
        <div>
            <Typography variant="h6">Practitioner</Typography>
            <Reference references={[practitioner]} name="Practitioner"/>

            <Typography variant="h6">Organization</Typography>
            <Reference references={[organization]} name="Organization"/>

            <Typography variant="h6">Location</Typography>
            <Reference references={location} name="Location"/>

            <Typography variant="h6">Schedule</Typography>
            <ReverseReference reverseReferences={[{target: 'Schedule', property: 'actor'}]} id={id} name="Schedule"/>

            <Typography variant="h6">Healthcare Service</Typography>
            <Reference references={healthcareService} name="Healthcare Service"/>

            <Typography variant="h6">Specialty</Typography>
            <CodeableConcept resourceType={resourceType} codeableConcepts={specialty} name="Specialty"
                             searchParameter='specialty'/>
        </div>
    );
}

export default PractitionerRole;
