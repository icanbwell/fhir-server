import React from 'react';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import {Typography} from '@mui/material';

const Slot = ({resource}) => {
    return (
        <div>
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.serviceCategory}
                name="Service Category"
                searchParameter='service-category'
            />

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.serviceType}
                name="Service Type"
                searchParameter='service-type'
            />

            <Reference
                references={[resource.schedule]}
                name="Schedule"
            />

            <Typography variant="h4">Start</Typography>
            <Typography variant="body1">{resource.start}</Typography>
            <Typography variant="h4">End</Typography>
            <Typography variant="body1">{resource.end}</Typography>
        </div>
    );
};

export default Slot;
