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

/**
 * create a timeline of all the events in this person's health record in one list sorted by date of the event.  Return the result in the following json format: { "date", "event", "resourceType", "eventSummary"}.  First create a list, convert event date into a date format and then sort it by the date of the event in ascending order.  Make sure your sorting is correct.
 */
const patientEvents = [
    {
        "date": "1983-12-01",
        "event": "Birth Date",
        "resourceType": "Patient",
        "eventSummary": "Patient was born on December 1, 1983."
    },
    {
        "date": "2019-01-15",
        "event": "Diagnosis",
        "resourceType": "Encounter",
        "eventSummary": "Patient diagnosed with pneumonia"
    },
    {
        "date": "2019-02-03",
        "event": "Medication Prescription",
        "resourceType": "MedicationRequest",
        "eventSummary": "Prescription for antibiotics to treat pneumonia."
    },
    {
        "date": "2019-02-10",
        "event": "Follow-up Appointment",
        "resourceType": "Appointment",
        "eventSummary": "Patient scheduled for a follow-up appointment to monitor pneumonia treatment."
    },
    {
        "date": "2019-03-05",
        "event": "Laboratory Test",
        "resourceType": "DiagnosticReport",
        "eventSummary": "Blood test results show improvement in pneumonia infection."
    },
    {
        "date": "2019-03-15",
        "event": "Discharge",
        "resourceType": "Encounter",
        "eventSummary": "Patient discharged from hospital after successful treatment of pneumonia."
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
