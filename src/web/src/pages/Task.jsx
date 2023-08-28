import React from 'react';
import Canonical from '../partials/Canonical';
import Uri from '../partials/Uri';
import Reference from '../partials/Reference';
import Identifier from '../partials/Identifier';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import NameValue from '../partials/NameValue';
import Period from '../partials/Period';
import DateTime from '../partials/DateTime';
import Annotation from '../partials/Annotation';
import {Typography} from '@mui/material';
import Boolean from '../partials/Boolean';
import Decimal from '../partials/Decimal';
import Instant from '../partials/Instant';
import Integer from '../partials/Integer';
import Markdown from '../partials/Markdown';
import Time from '../partials/Time';

const Task = ({resource}) => (
    <>
        <Canonical value={resource.instantiatesCanonical} name="Instantiates"/>
        <Uri value={resource.instantiatesUri} name="Instantiates"/>
        <Reference references={resource.basedOn} name="Based On"/>
        <Identifier resourceType={resource.resourceType} identifiers={resource.groupIdentifier}
                    name="Group Identifier"/>
        <Reference references={resource.partOf} name="Part Of"/>
        <Code value={resource.status} name="Status"/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.statusReason}
                         name="Status Reason" searchParameter=''/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.businessStatus}
                         name="Business Status" searchParameter=''/>
        <Code value={resource.intent} name="Intent"/>
        <Code value={resource.priority} name="Priority"/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.code} name="Code"
                         searchParameter=''/>
        <NameValue value={resource.description} name="Description"/>
        <Reference references={resource.focus} name="Focus"/>
        <Reference references={resource.for} name="For"/>
        <Reference references={resource.encounter} name="Encounter"/>
        <Period periods={resource.executionPeriod} name="Execution Period"/>
        <DateTime value={resource.authoredOn} name="Authored On"/>
        <DateTime value={resource.lastModified} name="Last Modified"/>
        <Reference references={resource.requester} name="Requester"/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.performerType}
                         name="Performer Type" searchParameter=''/>
        <Reference references={resource.owner} name="Owner"/>
        <Reference references={resource.location} name="Location"/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reasonCode} name="Reason Code"
                         searchParameter=''/>
        <Reference references={resource.reasonReference} name="Reason Reference"/>
        <Reference references={resource.insurance} name="Insurance"/>
        <Annotation annotations={resource.note} name="Note"/>
        <Reference references={resource.relevantHistory} name="Relevant History"/>
        {resource.restriction && (
            <>
                <Typography variant="h4">Restriction</Typography>
                <NameValue value={resource.restriction.repetitions} name="Repetitions"/>
                <Period periods={resource.restriction.period} name="Period"/>
                <Reference references={resource.restriction.recipient} name="Recipient"/>
            </>
        )}
        {resource.input && resource.input.map((input, index) => (
            <div key={index}>
                <Typography variant="h4">Input</Typography>
                <CodeableConcept resourceType={resource.resourceType} codeableConcepts={input.type} name="Type"/>
                <Boolean value={input.valueBoolean} name="Value"/>
                <Canonical value={input.valueCanonical} name="Value"/>
                <Code value={input.valueCode} name="Value"/>
                <DateTime value={input.valueDate} name="Value"/>
                <DateTime value={input.valueDateTime} name="Value"/>
                <Decimal value={input.valueDecimal} name="Value"/>
                <NameValue value={input.valueId} name="Value"/>
                <Instant value={input.valueInstant} name="Value"/>
                <Integer value={input.valueInteger} name="Value"/>
                <Markdown value={input.valueMarkdown} name="Value"/>
                <Integer value={input.valuePositiveInt} name="Value"/>
                <NameValue value={input.valueString} name="Value"/>
                <Time value={input.valueTime} name="Value"/>
                <Reference references={input.valueReference} name="Value"/>
                {/* TODO: Other properties */}
            </div>
        ))}
        {resource.output && resource.output.map((output, index) => (
            <div key={index}>
                <Typography variant="h4">Output</Typography>
                <CodeableConcept resourceType={resource.resourceType} codeableConcepts={output.type} name="Type"/>
                <Boolean value={output.valueBoolean} name="Value"/>
                <Canonical value={output.valueCanonical} name="Value"/>
                <Code value={output.valueCode} name="Value"/>
                <DateTime value={output.valueDate} name="Value"/>
                <DateTime value={output.valueDateTime} name="Value"/>
                <Decimal value={output.valueDecimal} name="Value"/>
                <NameValue value={output.valueId} name="Value"/>
                <Instant value={output.valueInstant} name="Value"/>
                <Integer value={output.valueInteger} name="Value"/>
                <Markdown value={output.valueMarkdown} name="Value"/>
                <Integer value={output.valuePositiveInt} name="Value"/>
                <NameValue value={output.valueString} name="Value"/>
                <Time value={output.valueTime} name="Value"/>
                <Reference references={output.valueReference} name="Value"/>
                {/* TODO: Other properties */}
            </div>
        ))}
    </>
);

export default Task;
