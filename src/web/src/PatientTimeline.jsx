import React from 'react';
import {VerticalTimeline, VerticalTimelineElement} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import MedicalInformationIcon from '@mui/icons-material/MedicalInformation';
import SettingsAccessibilityIcon from '@mui/icons-material/SettingsAccessibility';
import MedicationIcon from '@mui/icons-material/Medication';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import BiotechIcon from '@mui/icons-material/Biotech';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';

function getIcon(patientEvent) {
    // https://mui.com/material-ui/material-icons/
    switch (patientEvent.resourceType) {
        case 'Patient':
            return <SettingsAccessibilityIcon/>;
        case 'Condition':
            return <HealthAndSafetyIcon/>;
        case 'Observation':
            return <BiotechIcon/>;
        case 'Immunization':
            return <VaccinesIcon/>;
        case 'ExplanationOfBenefit':
        case 'Coverage':
            return <AttachMoneyIcon/>;
        case 'MedicationDispense':
        case 'MedicationRequest':
            return <MedicationIcon/>;
        default:
            return <MedicalInformationIcon/>;
    }
}

const renderTimelineElements = (patientEvents) => {
    return patientEvents.map((patientEvent, index) => (
        <VerticalTimelineElement
            className="vertical-timeline-element--work"
            contentStyle={{background: 'rgb(33, 150, 243)', color: '#fff'}}
            contentArrowStyle={{borderRight: '7px solid  rgb(33, 150, 243)'}}
            key={index}
            date={patientEvent.date}
            iconStyle={{background: '#007bff', color: '#fff'}} // Customize the icon color if needed
            icon={getIcon(patientEvent)}
        >
            <h3 className="vertical-timeline-element-title">{patientEvent.resourceType}</h3>
            <p className="vertical-timeline-element-subtitle">{patientEvent.event}</p>
            <p>{`${patientEvent.eventSummary}`}</p>
        </VerticalTimelineElement>
    ));
};

const patientEvents = [
    {
        "date": "1983-12-01",
        "event": "Birth Date",
        "resourceType": "Patient",
        "eventSummary": "Patient was born on December 1, 1983."
    },
    {
        "date": "2012-10-20",
        "event": "Immunization: Tetanus toxoid",
        "resourceType": "Immunization",
        "eventSummary": "Patient received the Tetanus toxoid immunization on October 20, 2012."
    },
    {
        "date": "2018-05-03",
        "event": "Observation: Total score [DAST-10] - Value: 2",
        "resourceType": "Observation",
        "eventSummary": "Patient's DAST-10 score was 2 on May 3, 2018."
    },
    {
        "date": "2019-05-09",
        "event": "Observation: Total score [DAST-10] - Value: 1",
        "resourceType": "Observation",
        "eventSummary": "Patient's DAST-10 score was 1 on May 9, 2019."
    },
    {
        "date": "2019-09-26",
        "event": "Onset of Tendinopathy of patella (M67.969)",
        "resourceType": "Condition",
        "eventSummary": "Patient experienced the onset of Tendinopathy of patella (M67.969) on September 26, 2019."
    },
    {
        "date": "2019-09-26",
        "event": "Recorded Date for Tendinopathy of patella diagnosis",
        "resourceType": "Condition",
        "eventSummary": "Tendinopathy of patella (M67.969) diagnosis was recorded on September 26, 2019."
    },
    {
        "date": "2020-01-01",
        "event": "Coverage Period: Insurance Coverage (Coverage ID: 3b8d95db-fa41-4d88-9769-9107293850e5), Policy Type: MCHMO1 (MEDICARE HMO PLAN), Deductible: GR5 (GR5-HMO DEDUCTIBLE)",
        "resourceType": "Coverage",
        "eventSummary": "Patient's insurance coverage (MCHMO1) with policy type Medicare HMO plan and deductible GR5 (GR5-HMO Deductible) started on January 1, 2020."
    },
    {
        "date": "2020-07-09",
        "event": "Medication Request: Azithromycin 250 MG Oral Tablet for Traveler's diarrhea",
        "resourceType": "MedicationRequest",
        "eventSummary": "Patient's healthcare provider requested Azithromycin 250 MG Oral Tablet for traveler's diarrhea on July 9, 2020."
    },
    {
        "date": "2020-07-09",
        "event": "Medication Dispense: Azithromycin 250 MG Oral Tablet - Quantity: 6 tablets, Days Supply: 6 days, Dosage Instruction: One tablet at once, to be taken orally, with or after food, once a day, Note: Patient told to take with food",
        "resourceType": "MedicationDispense",
        "eventSummary": "Patient received Azithromycin 250 MG Oral Tablet with a quantity of 6 tablets on July 9, 2020. Dosage instruction: One tablet at once, to be taken orally, with or after food, once a day. Patient was advised to take with food."
    },
    {
        "date": "2022-05-26",
        "event": "Observation: Total score [DAST-10] - Value: 2",
        "resourceType": "Observation",
        "eventSummary": "Patient's DAST-10 score was 2 on May 26, 2022."
    }
];

const PatientTimeline = () => {
    return (
        <VerticalTimeline>
            {renderTimelineElements(patientEvents)}
        </VerticalTimeline>
    );
};


export default PatientTimeline;
