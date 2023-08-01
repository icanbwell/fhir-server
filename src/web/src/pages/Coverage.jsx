import React from 'react';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import CodeableConceptWithValue from '../partials/CodeableConceptWithValue';
import Period from '../partials/Period';

const Coverage = ({resource, admin, index}) => {

    return (
        <>
            <Code resource={resource}/>
            <CodeableConcept resource={resource}/>
            <Reference name="subscriber" resource={resource}/>
            <Reference name="beneficiary" resource={resource}/>
            <Reference name="payor" resource={resource}/>
            <Period resource={resource}/>
            <CodeableConceptWithValue resource={resource}/>
            <Reference name="contract" resource={resource}/>
        </>
    );
};

export default Coverage;
