import React from 'react';
import Uri from '../partials/Uri';
import NameValue from '../partials/NameValue';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Markdown from '../partials/Markdown';
import Period from '../partials/Period';

const Measure = ({resource}) => {
    return (
        <React.Fragment>
            <Uri value={resource.url} name="URL"/>
            <NameValue value={resource.version} name="Version"/>
            <NameValue value={resource.name} name="Name"/>
            <NameValue value={resource.title} name="Title"/>
            <NameValue value={resource.subtitle} name="Subtitle"/>

            <Code value={resource.status} name="Status"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.subjectCodeableConcept}
                             name="Subject"/>
            <Reference references={resource.subjectReference} name="Subject"/>

            <DateTime value={resource.date} name="Date"/>

            <Markdown value={resource.markdown} name="Markdown"/>

            <DateTime value={resource.approvalDate} name="Approval Date"/>
            <DateTime value={resource.lastReviewDate} name="Last Review Date"/>

            <Period periods={resource.effectivePeriod} name="Effective Period"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.topic} name="Topic"/>

            <Uri value={resource.library} name="URL"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.scoring} name="Scoring"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.compositeScoring}
                             name="Composite Scoring"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.type} name="Type"/>

            <Markdown value={resource.definition} name="Definition"/>
        </React.Fragment>
    );
};

export default Measure;
