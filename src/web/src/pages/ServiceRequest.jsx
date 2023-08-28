import React from 'react';
import {Typography, Box} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import Period from '../partials/Period';

function ServiceRequest({resource}) {
    return (
        <Box>
            <Typography variant="h6">Status</Typography>
            <Typography variant="body1">{resource.active}</Typography>

            <Typography variant="h6">Intent</Typography>
            <Typography variant="body1">{resource.intent}</Typography>

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={[resource.code]}
                name="Code"
                searchParameter='code'
            />

            <Reference
                references={[resource.subject]}
                name="Subject"
            />

            <Period
                periods={[resource.occurrencePeriod]}
                name="Occurrence Period"
            />

            {resource.note && (
                <>
                    <Typography variant="h6">Note</Typography>
                    {resource.note.map((note, index) => (
                        <Typography key={index} variant="body1">{note.text}</Typography>
                    ))}
                </>
            )}
        </Box>
    );
}

export default ServiceRequest;
