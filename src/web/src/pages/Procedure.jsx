import {Box} from '@mui/material';
import Code from '../partials/Code';
import Reference from '../partials/Reference';
import CodeableConcept from '../partials/CodeableConcept';
import DateTime from '../partials/DateTime';
import Period from '../partials/Period';
import Performer from '../partials/Performer';
import Annotation from '../partials/Annotation';

const Procedure = ({resource}) => {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>

            <Reference references={resource.basedOn} name="Based On"/>
            <Reference references={resource.partOf} name="Part Of"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.statusReason]}
                             name="Status Reason" searchParameter=""/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.category]} name="Category"
                             searchParameter=""/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.code]} name="Code"
                             searchParameter=""/>

            <Reference references={[resource.subject]} name="Subject"/>
            <Reference references={[resource.encounter]} name="Encounter"/>
            <Reference references={resource.location} name="Location"/>

            <DateTime value={resource.performedDateTime} name="Performed Date"/>
            <Period periods={resource.performedPeriod} name="Period"/>

            <Performer performers={resource.performer} name="Performers"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.bodySite} name="Body Site"
                             searchParameter=""/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.outcome]} name="Outcome"
                             searchParameter=""/>

            <Reference references={resource.report} name="Report"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.followUp} name="Follow Up"
                             searchParameter=""/>

            <Reference references={resource.usedReference} name="Used"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.usedCode} name="Used Code"
                             searchParameter=""/>

            <Reference references={resource.reasonReference} name="Reason"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.reasonCode}
                             name="Reason Code" searchParameter=""/>

            <Annotation annotations={resource.note} name="Notes"/>
        </Box>
    );
};

export default Procedure;
