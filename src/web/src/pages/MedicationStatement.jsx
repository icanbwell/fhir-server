// MainComponent.js
import React from 'react';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Period from '../partials/Period';
import Annotation from '../partials/Annotation';
import Dosage from '../partials/Dosage';

const MedicationStatement = ({resource}) => (
    <div>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.statusReason}
                         name="Status Reason" searchParameter=''/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.category} name="Category"
                         searchParameter=''/>
        <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.medicationCodeableConcept}
                         name="Medication" searchParameter=''/>

        <Reference references={resource.basedOn} name="Based On"/>
        <Reference references={resource.partOf} name="Part Of"/>
        <Reference references={resource.medicationReference} name="Medication"/>
        <Reference references={resource.subject} name="Subject"/>
        <Reference references={resource.context} name="Context"/>
        <Reference references={resource.informationSource} name="Information Source"/>
        <Reference references={resource.derivedFrom} name="Derived From"/>
        <Reference references={resource.reasonReference} name="Reason Reference"/>

        <DateTime value={resource.effectiveDateTime} name="Effective Date"/>
        <DateTime value={resource.dateAsserted} name="Date Asserted"/>

        <Period periods={resource.effectivePeriod} name="Effective Period"/>

        <Annotation annotations={resource.note} name="Notes"/>

        <Dosage dosages={resource.dosage} name="Dosage"/>
    </div>
);

export default MedicationStatement;
