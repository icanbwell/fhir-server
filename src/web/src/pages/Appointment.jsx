import React from 'react';
import Code from '../partials/Code';
import DateTime from '../partials/DateTime';
import CodeableConcept from '../partials/CodeableConcept';
import Participant from '../partials/Participant';
import {Box} from '@mui/material';

const Apppointment = ({resource}) => {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>
            <DateTime value={resource.start} name="Start Date"/>
            <DateTime value={resource.created} name="Created Date"/>
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.serviceCategory}
                name="Service Category"
                searchParameter="service-category"
            />
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.serviceType}
                name="Service Type"
                searchParameter="service-type"
            />
            <Participant
                resourceType={resource.resourceType}
                participants={resource.participant}
                name="Participants"
            />
        </Box>
    );
};

export default Apppointment;
