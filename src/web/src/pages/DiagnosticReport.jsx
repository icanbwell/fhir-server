import React from 'react';
import { Box } from '@mui/material';
import Uri from '../partials/Uri';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import DateTime from '../partials/DateTime';
import Period from '../partials/Period';
import NameValue from '../partials/NameValue';
import Attachment from '../partials/Attachment';
import Reference from '../partials/Reference';
import DiagnosticReportMedia from '../partials/DiagnosticReportMedia';

const DiagnosticReport = ({ resource, admin, index }) => {
    return (
        <Box>
            <Uri name="Implicit Rules" value={resource.implicitRules} />
            <Code name="Language" value={resource.language} />
            <Code name="Status" value={resource.status} />
            <CodeableConcept
                name="Category"
                codeableConcepts={resource.category}
                resourceType={resource.resourceType}
                searchParameter=""
            />
            <CodeableConcept
                name="Code"
                codeableConcepts={resource.code}
                resourceType={resource.resourceType}
                searchParameter=""
            />
            <DateTime name="Issued Date" value={resource.issued} />
            <DateTime name="Effective Date" value={resource.effectiveDateTime} />
            <Period name="Effective Period" periods={resource.effectivePeriod} />
            <NameValue name="Conclusion" value={resource.conclusion} />
            <CodeableConcept
                name="Conclusion Code"
                codeableConcepts={resource.conclusionCode}
                resourceType={resource.resourceType}
                searchParameter=""
            />
            <Attachment value={resource.presentedForm} />
            <DiagnosticReportMedia name="Media" medias={resource.media} />
            <Reference name="Based On" references={resource.basedOn} />
            <Reference name="Performer" references={resource.performer} />
            <Reference name="Results Interpreter" references={resource.resultsInterpreter} />
            <Reference name="Specimen" references={resource.specimen} />
            <Reference name="Result" references={resource.result} />
            <Reference name="Imaging Study" references={resource.imagingStudy} />
            <Reference name="Subject" references={resource.subject} />
            <Reference name="Encounter" references={resource.encounter} />
        </Box>
    );
};

export default DiagnosticReport;
