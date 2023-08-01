import React from 'react';
import {Box} from '@mui/material';
import Code from '../partials/Code';
import Coding from '../partials/Coding';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import Period from '../partials/Period';
import NameValue from '../partials/NameValue';

const Encounter = ({resource}) => (
    <Box>
        <Code value={resource.status} name="Status"/>
        <Coding resourceType={resource.resourceType} codings={resource.class} name="Class" searchParameter='class'/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.type} name="Type"
                         searchParameter='type'/>
        <Reference references={resource.subject} name="Subject"/>

        {resource.participant && resource.participant.map((participant) =>
            <Reference key={participant.individual.id} references={participant.individual} name="Participant"/>)}

        <Period periods={resource.period} name="Period"/>
        <NameValue value={resource.length} name="Length"/>

        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reasonCode} name="Reason Code"
                         searchParameter='reason-code'/>
        <Reference references={resource.reasonReference} name="Reason"/>

        {resource.diagnosis && resource.diagnosis.map((diagnosis) => (
            <React.Fragment key={diagnosis.condition.id}>
                <Reference references={diagnosis.condition} name="Condition"/>
                <CodeableConcept resourceType={resource.resourceType} codeableConcepts={diagnosis.use} name="Use"
                                 searchParameter='reason-code'/>
                <NameValue value={diagnosis.rank} name="Rank"/>
            </React.Fragment>
        ))}

        {resource.location && resource.location.map((location) =>
            <Reference key={location.location.id} references={[location.location]} name="Location"/>)}

        <Reference references={resource.serviceProvider} name="Service Provider"/>
        <Reference references={resource.partOf} name="Part Of"/>
    </Box>
);

export default Encounter;
