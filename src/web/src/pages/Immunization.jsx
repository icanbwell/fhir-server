import React from "react";
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import NameValue from '../partials/NameValue';
import Quantity from '../partials/Quantity';
import Performer from '../partials/Performer';
import Annotation from '../partials/Annotation';
import {Box} from '@mui/material';

function Immunization({resource}) {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.statusReason}
                             name="Status Reason" searchParameter=''/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.vaccineCode} name="Code"
                             searchParameter=''/>

            <Reference references={resource.patient} name="Patient"/>

            <Reference references={resource.encounter} name="Encounter"/>

            <Reference references={resource.location} name="Location"/>

            <DateTime value={resource.occurrenceDateTime} name="Occurrence Date"/>

            <NameValue value={resource.occurrenceString} name="Occurrence"/>

            <DateTime value={resource.recorded} name="Recorded Date"/>

            <NameValue value={resource.primarySource} name="Primary Source"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reportOrigin}
                             name="Report Origin" searchParameter=''/>

            <NameValue value={resource.lotNumber} name="Lot Number"/>

            <DateTime value={resource.expirationDate} name="Expiration Date"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.site} name="Site"
                             searchParameter=''/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.route} name="Route"
                             searchParameter=''/>

            <DateTime value={resource.expirationDate} name="Expiration Date"/>

            <Quantity value={resource.doseQuantity} name="Dose Quantity"/>

            <Performer performers={resource.performer} name="Performers"/>

            <Annotation annotations={resource.note} name="Notes"/>
        </Box>
    );
}

export default Immunization;
