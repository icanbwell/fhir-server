import Practitioner from './Practitioner';
import Patient from './Patient';
import Account from './Account';
import ActivityDefinition from './ActivityDefinition';
import AllergyIntolerance from './AllergyIntolerance';
import CareTeam from './CareTeam';
import Appointment from './Appointment';
import AuditEvent from './AuditEvent';
import Communication from './Communication';
import Encounter from './Encounter';
import InsurancePlan from './InsurancePlan';
import Library from './Library';
import Measure from './Measure';
import Medication from './Medication';
import MedicationAdministration from './MedicationAdministration';
import MedicationDispense from './MedicationDispense';
import MedicationRequest from './MedicationRequest';
import Observation from './Observation';
import Condition from './Condition';
import Consent from './Consent';
import Coverage from './Coverage';
import ExplanationOfBenefit from './ExplanationOfBenefit';
import HealthcareService from './HealthcareService';
import Immunization from './Immunization';
import Location from './Location';
import MeasureReport from './MeasureReport';
import MedicationStatement from './MedicationStatement';
import Organization from './Organization';
import OrganizationAffiliation from './OrganizationAffiliation';
import Person from './Person';
import PractitionerRole from './PractitionerRole';
import Procedure from './Procedure';
import QuestionnaireResponse from './QuestionnaireResponse';
import Schedule from './Schedule';
import ServiceRequest from './ServiceRequest';
import Slot from './Slot';
import Task from './Task';
import ValueSet from './ValueSet';
import DomainResource from './DomainResource';
import OperationOutcome from './OperationOutcome';

function ResourceItem({resourceType, resource, index}) {
    console.log(`ResourceItem: resourceType=${resourceType}`);
    switch (resourceType) {
        case 'Account':
            return <Account resource={resource} index={index}/>;
        case 'ActivityDefinition':
            return <ActivityDefinition resource={resource} index={index}/>;
        case 'AllergyIntolerance':
            return <AllergyIntolerance resource={resource} index={index}/>;
        case 'Appointment':
            return <Appointment resource={resource} index={index}/>;
        case 'AuditEvent':
            return <AuditEvent resource={resource} index={index}/>;
        case 'CareTeam':
            return <CareTeam resource={resource} index={index}/>;
        case 'Communication':
            return <Communication resource={resource} index={index}/>;
        case 'Condition':
            return <Condition resource={resource} index={index}/>;
        case 'Consent':
            return <Consent resource={resource} index={index}/>;
        case 'Coverage':
            return <Coverage resource={resource} index={index}/>;
        case 'Encounter':
            return <Encounter resource={resource} index={index}/>;
        case 'ExplanationOfBenefit':
            return <ExplanationOfBenefit resource={resource} index={index}/>;
        case 'HealthcareService':
            return <HealthcareService resource={resource} index={index}/>;
        case 'Immunization':
            return <Immunization resource={resource} index={index}/>;
        case 'InsurancePlan':
            return <InsurancePlan resource={resource} index={index}/>;
        case 'Library':
            return <Library resource={resource} index={index}/>;
        case 'Location':
            return <Location resource={resource} index={index}/>;
        case 'Measure':
            return <Measure resource={resource} index={index}/>;
        case 'MeasureReport':
            return <MeasureReport resource={resource} index={index}/>;
        case 'Medication':
            return <Medication resource={resource} index={index}/>;
        case 'MedicationAdministration':
            return <MedicationAdministration resource={resource} index={index}/>;
        case 'MedicationDispense':
            return <MedicationDispense resource={resource} index={index}/>;
        case 'MedicationRequest':
            return <MedicationRequest resource={resource} index={index}/>;
        case 'MedicationStatement':
            return <MedicationStatement resource={resource} index={index}/>;
        case 'Observation':
            return <Observation resource={resource} index={index}/>;
        case 'OperationOutcome':
            return <OperationOutcome resource={resource} index={index}/>;
        case 'Organization':
            return <Organization resource={resource} index={index}/>;
        case 'OrganizationAffiliation':
            return <OrganizationAffiliation resource={resource} index={index}/>;
        case 'Patient':
            return <Patient resource={resource} index={index}/>;
        case 'Person':
            return <Person resource={resource} index={index}/>;
        case 'Practitioner':
            return <Practitioner resource={resource} index={index}/>;
        case 'PractitionerRole':
            return <PractitionerRole resource={resource} index={index}/>;
        case 'Procedure':
            return <Procedure resource={resource} index={index}/>;
        case 'QuestionnaireResponse':
            return <QuestionnaireResponse resource={resource} index={index}/>;
        case 'Schedule':
            return <Schedule resource={resource} index={index}/>;
        case 'ServiceRequest':
            return <ServiceRequest resource={resource} index={index}/>;
        case 'Slot':
            return <Slot resource={resource} index={index}/>;
        case 'Task':
            return <Task resource={resource} index={index}/>;
        case 'ValueSet':
            return <ValueSet resource={resource} index={index}/>;
        default:
            return <DomainResource resource={resource} index={index}/>;
    }
}

export default ResourceItem;
