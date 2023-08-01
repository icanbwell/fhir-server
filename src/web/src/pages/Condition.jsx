import React from 'react';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import {Box} from '@mui/material';

const Condition = ({resource}) => {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.clinicalStatus]}
                             name="Clinical Status" searchParameter='clinical-status'/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.verificationStatus]}
                             name="Verification Status" searchParameter='verification-status'/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.category} name="Category"
                             searchParameter='category'/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.severity]} name="Severity"
                             searchParameter='severity'/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.code]} name="Code"
                             searchParameter='code'/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.bodySite} name="Body Site"
                             searchParameter='body-site'/>

            <Reference references={[resource.subject]} name="Subject"/>
            <Reference references={[resource.encounter]} name="Encounter"/>

            <DateTime value={resource.onsetDateTime} name="Onset Date"/>
            <DateTime value={resource.recordedDate} name="Recorded Date"/>

            <Reference references={[resource.recorder]} name="Recorder"/>
        </Box>
    );
}

export default Condition;
