import React from 'react';
import {Typography} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import ReverseReference from '../partials/ReverseReference';

function Schedule({resource}) {
    return (
        <div>
            <Typography variant="h4">Active</Typography>
            <Typography variant="body1">{resource.active}</Typography>

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.serviceType}
                name="Service Type"
                searchParameter="service-type"
            />

            <Reference
                references={resource.actor}
                name="Actor"
            />

            <ReverseReference
                reverseReferences={[{target: 'Slot', property: 'schedule'}]}
                id={resource.id}
                name="Slot"
            />

            <ReverseReference
                reverseReferences={[{target: 'HealthcareService', property: 'actor'}]}
                id={resource.id}
                name="HealthcareService"
            />

            <ReverseReference
                reverseReferences={[{target: 'Location', property: 'actor'}]}
                id={resource.id}
                name="Location"
            />

            <ReverseReference
                reverseReferences={[{target: 'Patient', property: 'actor'}]}
                id={resource.id}
                name="Patient"
            />

            <ReverseReference
                reverseReferences={[{target: 'PractitionerRole', property: 'actor'}]}
                id={resource.id}
                name="PractitionerRole"
            />
        </div>
    );
}

export default Schedule;
