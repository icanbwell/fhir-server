import React from 'react';
import Reference from '../partials/Reference';
import CodeableConcept from '../partials/CodeableConcept';
import ReverseReference from '../partials/ReverseReference';

import {Box} from '@mui/material';

const HealthcareService = ({resource}) => {
    return (
        <Box>
            <Reference references={[resource.providedBy]} name="Provided By"/>
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.type}
                name="Type"
                searchParameter='service-type'
            />
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.specialty}
                name="Specialty"
                searchParameter='specialty'
            />
            <Reference references={resource.location} name="Location"/>
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.characteristic}
                name="Characteristic"
                searchParameter='characteristic'
            />
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.communication}
                name="Communication"
                searchParameter=''
            />
            <ReverseReference
                reverseReferences={[{target: 'PractitionerRole', property: 'actor'}]}
                id={resource.id}
                name="Practitioner Role"
            />
            <ReverseReference
                reverseReferences={[{target: 'Schedule', property: 'healthcareService'}]}
                id={resource.id}
                name="Schedule"
            />
        </Box>
    );
}

export default HealthcareService;
