import React from 'react';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import NameValue from '../partials/NameValue';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Annotation from '../partials/Annotation';
import Dosage from '../partials/Dosage';
import DispenseRequest from '../partials/DispenseRequest';

const MedicationRequest = ({resource}) => {
    return (
        <div>
            <Code value={resource.status} name="Status"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.statusReason}
                             name="Status Reason" searchParameter=''/>
            <Code value={resource.intent} name="Intent"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.category} name="Category"
                             searchParameter=''/>
            <Code value={resource.priority} name="Priority"/>
            <NameValue value={resource.doNotPerform} name="Do Not Perform"/>
            <NameValue value={resource.reportedBoolean} name="Reported"/>
            <Reference references={resource.reportedReference} name="Reported"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.medicationCodeableConcept}
                             name="Medication" searchParameter=''/>
            <Reference references={resource.medicationReference} name="Medication"/>
            <Reference references={resource.subject} name="Subject"/>
            <Reference references={resource.encounter} name="Encounter"/>
            <Reference references={resource.supportingInformation} name="Supporting Information"/>
            <DateTime value={resource.authoredOn} name="Authored On"/>
            <Reference references={resource.requester} name="Requester"/>
            <Reference references={resource.performer} name="Performer"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.performerType}
                             name="Performer Type" searchParameter=''/>
            <Reference references={resource.recorder} name="Recorder"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reasonCode}
                             name="Reason Code" searchParameter=''/>
            <Reference references={resource.reasonReference} name="Reason Reference"/>
            <Reference references={resource.basedOn} name="Based On"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.courseOfTherapyType}
                             name="Course of Therapy" searchParameter=''/>
            <Reference references={resource.insurance} name="Insurance"/>
            <Annotation annotations={resource.note} name="Notes"/>
            <Dosage dosages={resource.dosageInstruction} name="Dosage"/>
            <DispenseRequest value={resource.dispenseRequest} name="Dispense Request"/>
            {resource.substitution && (
                <>
                    <NameValue value={resource.substitution.allowedBoolean} name="Allowed"/>
                    <CodeableConcept resourceType={resource.resourceType}
                                     codeableConcepts={resource.courseOfTherapyType} name="Allowed" searchParameter=''/>
                    <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reason}
                                     name="Reason" searchParameter=''/>
                </>
            )}
            <Reference references={resource.priorPrescription} name="Prior Prescription"/>
            <Reference references={resource.detectedIssue} name="Detected Issue"/>
            <Reference references={resource.eventHistory} name="Event History"/>
        </div>
    );
};

export default MedicationRequest;
