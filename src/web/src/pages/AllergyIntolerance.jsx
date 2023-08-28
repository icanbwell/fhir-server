import React from 'react';
import {Box} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Code from '../partials/Code';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Period from '../partials/Period';
import NameValue from '../partials/NameValue';
import Annotation from '../partials/Annotation';

const AllergyIntolerance = ({resource, index}) => (
    <Box>
        <CodeableConcept
            resourceType={resource.resourceType}
            codeableConcepts={resource.clinicalStatus}
            name="Clinical Status"
            searchParameter=''
        />

        <CodeableConcept
            resourceType={resource.resourceType}
            codeableConcepts={resource.verificationStatus}
            name="Verification Status"
            searchParameter=''
        />

        <Code value={resource.type} name="Type"/>
        <Code value={resource.category} name="Category"/>
        <Code value={resource.criticality} name="Criticality"/>

        <CodeableConcept
            resourceType={resource.resourceType}
            codeableConcepts={resource.code}
            name="Code"
            searchParameter=''
        />

        <Reference references={resource.patient} name="Patient"/>
        <Reference references={resource.encounter} name="Encounter"/>

        <DateTime value={resource.onsetDateTime} name="Onset Date"/>
        <Period periods={resource.onsetPeriod} name="Onset Period"/>
        <NameValue value={resource.onsetAge} name="Onset Age"/>

        <DateTime value={resource.recordedDate} name="Recorded Date"/>
        <Reference references={resource.recorder} name="Recorder"/>
        <Reference references={resource.asserter} name="Asserter"/>

        <DateTime value={resource.lastOccurrence} name="Last Occurrence"/>

        <Annotation annotations={resource.note} name="Notes"/>
    </Box>
);

export default AllergyIntolerance;
