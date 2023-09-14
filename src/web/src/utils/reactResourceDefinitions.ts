/**
 * This file specifies information for FHIR resources shown on the home opage
 */
import {ResourceDefinition} from "./resourceDefinition";

const resourceDefinitions: ResourceDefinition[] = [
    {
        name: 'Account',
        description: 'A financial tool for tracking value accrued for a particular purpose. In the healthcare field, used to track charges for a patient, cost centers, etc.',
        url: 'https://www.hl7.org/fhir/account.html'
    },
    {
        name: 'ActivityDefinition',
        description: 'An ActivityDefinition is a shareable, consumable description of some activity to be performed. It may be used to specify actions to be taken as part of a workflow, order set, or protocol, or it may be used independently as part of a catalog of activities such as orderables.',
        url: 'https://www.hl7.org/fhir/activitydefinition.html'
    },
    {
        name: 'AllergyIntolerance',
        description: 'Risk of harmful or undesirable, physiological response which is unique to an individual and associated with exposure to a substance.',
        url: 'https://www.hl7.org/fhir/allergyintolerance.html'
    },
    {
        name: 'Appointment',
        description: 'A booking of a healthcare event among patient(s), practitioner(s), related person(s) and/or device(s) for a specific date/time. This may result in one or more Encounter(s).',
        url: 'https://www.hl7.org/fhir/appointment.html'
    },
    {
        name: 'AuditEvent',
        description: 'A record of an event made for purposes of maintaining a security log. Typical uses include detection of intrusion attempts and monitoring for inappropriate usage.',
        url: 'https://www.hl7.org/fhir/auditevent.html'
    },
    {
        name: 'CareTeam',
        description: 'The Care Team includes all the people and organizations who plan to participate in the coordination and delivery of care for a patient.',
        url: 'https://www.hl7.org/fhir/careteam.html'
    },
    {
        name: 'Communication',
        description: 'An occurrence of information being transmitted; e.g. an alert that was sent to a responsible provider, a public health agency that was notified about a reportable condition.',
        url: 'https://hl7.org/FHIR/communication.html'
    },
    {
        name: 'Condition',
        description: 'A clinical condition, problem, diagnosis, or other event, situation, issue, or clinical concept that has risen to a level of concern.',
        url: 'https://www.hl7.org/fhir/condition.html'
    },
    {
        name: 'Consent',
        description: 'A record of a healthcare consumer’s choices, which permits or denies identified recipient(s) or recipient role(s) to perform one or more actions within a given policy context, for specific purposes and periods of time.',
        url: 'https://www.hl7.org/fhir/consent.html'
    },
    {
        name: 'Coverage',
        description: 'Financial instrument which may be used to reimburse or pay for health care products and services. Includes both insurance and self-payment.',
        url: 'https://www.hl7.org/fhir/coverage.html'
    },
    {
        name: 'Encounter',
        description: 'An interaction between a patient and healthcare provider(s) for the purpose of providing healthcare service(s) or assessing the health status of a patient.',
        url: 'https://www.hl7.org/fhir/encounter.html'
    },
    {
        name: 'Endpoint',
        description: 'The technical details of an endpoint that can be used for electronic services, such as for web services providing XDS.b or a REST endpoint for another FHIR server. This may include any security context information.',
        url: 'https://www.hl7.org/fhir/R4/endpoint.html'
    },
    {
        name: 'ExplanationOfBenefit',
        description: 'This resource provides: the claim details; adjudication details from the processing of a Claim; and optionally account balance information, for informing the subscriber of the benefits provided.',
        url: 'http://hl7.org/fhir/R4/explanationofbenefit.html'
    },
    {
        name: 'HealthcareService',
        description: 'The details of a healthcare service available at a location.',
        url: 'https://www.hl7.org/fhir/healthcareservice.html'
    },
    {
        name: 'Immunization',
        description: 'Describes the event of a patient being administered a vaccine or a record of an immunization as reported by a patient, a clinician or another party.',
        url: 'https://www.hl7.org/fhir/immunization.html'
    },
    {
        name: 'InsurancePlan',
        description: 'Details of a Health Insurance product/plan provided by an organization.',
        url: 'https://www.hl7.org/fhir/insuranceplan.html'
    },
    {
        name: 'Invoice',
        description: 'Invoice containing collected ChargeItems from an Account with calculated individual and total price for Billing purpose.',
        url: 'https://www.hl7.org/fhir/invoice.html'
    },
    {
        name: 'Library',
        description: 'The Library resource is a general-purpose container for knowledge asset definitions. It can be used to describe and expose existing knowledge assets such as logic libraries and information model descriptions, as well as to describe a collection of knowledge assets.',
        url: 'https://www.hl7.org/fhir/library.html'
    },
    {
        name: 'Location',
        description: 'Details and position information for a physical place where services are provided and resources and participants may be stored, found, contained, or accommodated.',
        url: 'http://hl7.org/fhir/R4/location.html'
    },
    {
        name: 'Measure',
        description: 'The Measure resource represents a structured, computable definition of a health-related measure such as a clinical quality measure, public health indicator, or population analytics measure.',
        url: 'http://www.hl7.org/fhir/measure.html'
    },
    {
        name: 'MeasureReport',
        description: 'The MeasureReport resource contains the results of the calculation of a measure; and optionally a reference to the resources involved in that calculation.',
        url: 'https://www.hl7.org/fhir/measurereport.html'
    },
    {
        name: 'Medication',
        description: 'This resource is primarily used for the identification and definition of a medication for the purposes of prescribing, dispensing, and administering a medication as well as for making statements about medication use.',
        url: 'https://www.hl7.org/fhir/medication.html'
    },
    {
        name: 'MedicationAdministration',
        description: 'Describes the event of a patient consuming or otherwise being administered a medication. This may be as simple as swallowing a tablet or it may be a long running infusion. Related resources tie this event to the authorizing prescription, and the specific encounter between patient and health care practitioner.',
        url: 'https://hl7.org/FHIR/medicationadministration.html'
    },
    {
        name: 'MedicationDispense',
        description: 'Indicates that a medication product is to be or has been dispensed for a named person/patient. This includes a description of the medication product (supply) provided and the instructions for administering the medication. The medication dispense is the result of a pharmacy system responding to a medication order.',
        url: 'https://hl7.org/FHIR/medicationdispense.html'
    },
    {
        name: 'MedicationRequest',
        description: 'An order or request for both supply of the medication and the instructions for administration of the medication to a patient. The resource is called "MedicationRequest" rather than "MedicationPrescription" or "MedicationOrder" to generalize the use across inpatient and outpatient settings, including care plans, etc., and to harmonize with workflow patterns.',
        url: 'https://www.hl7.org/fhir/medicationrequest.html'
    },
    {
        name: 'MedicationStatement',
        description: 'A record of a medication that is being consumed by a patient. A MedicationStatement may indicate that the patient may be taking the medication now or has taken the medication in the past or will be taking the medication in the future. The source of this information can be the patient, significant other (such as a family member or spouse), or a clinician.',
        url: 'https://www.hl7.org/fhir/medicationstatement.html'
    },
    {
        name: 'Observation',
        description: 'Measurements and simple assertions made about a patient, device or other subject.',
        url: 'https://www.hl7.org/fhir/observation.html'
    },
    {
        name: 'Organization',
        description: 'A formally or informally recognized grouping of people or organizations formed for the purpose of achieving some form of collective action. Includes companies, institutions, corporations, departments, community groups, healthcare practice groups, payer/insurer, etc.',
        url: 'http://hl7.org/fhir/R4/organization.html'
    },
    {
        name: 'OrganizationAffiliation',
        description: 'Defines an affiliation/assotiation/relationship between 2 distinct oganizations, that is not a part-of relationship/sub-division relationship.',
        url: 'https://www.hl7.org/fhir/organizationaffiliation.html'
    },
    {
        name: 'Patient',
        description: 'Demographics and other administrative information about an individual or animal receiving care or other health-related services.',
        url: 'https://www.hl7.org/fhir/patient.html'
    },
    {
        name: 'Person',
        description: 'Demographics and administrative information about a person independent of a specific health-related context.',
        url: 'https://www.hl7.org/fhir/person.html'
    },
    {
        name: 'Practitioner',
        description: 'A person who is directly or indirectly involved in the provisioning of healthcare.',
        url: 'https://hl7.org/fhir/practitioner.html'
    },
    {
        name: 'PractitionerRole',
        description: 'A specific set of Roles/Locations/specialties/services that a practitioner may perform at an organization for a period of time.',
        url: 'http://hl7.org/fhir/R4/practitionerrole.html'
    },
    {
        name: 'Procedure',
        description: 'An action that is or was performed on or for a patient. This can be a physical intervention like an operation, or less invasive like long term services, counseling, or hypnotherapy.',
        url: 'https://www.hl7.org/fhir/procedure.html'
    },
    {
        name: 'QuestionnaireResponse',
        description: 'A structured set of questions and their answers. The questions are ordered and grouped into coherent subsets, corresponding to the structure of the grouping of the questionnaire being responded to.',
        url: 'https://www.hl7.org/fhir/questionnaireresponse.html'
    },
    {
        name: 'Schedule',
        description: 'A container for slots of time that may be available for booking appointments.',
        url: 'https://www.hl7.org/fhir/schedule.html'
    },
    {
        name: 'ServiceRequest',
        description: 'A record of a request for service such as diagnostic investigations, treatments, or operations to be performed.',
        url: 'https://hl7.org/fhir/servicerequest.html'
    },
    {
        name: 'Slot',
        description: 'A slot of time on a schedule that may be available for booking appointments.',
        url: 'https://www.hl7.org/fhir/slot.html'
    },
    {
        name: 'Task',
        description: 'A task resource describes an activity that can be performed and tracks the state of completion of that activity. It is a representation that an activity should be or has been initiated, and eventually, represents the successful or unsuccessful completion of that activity.',
        url: 'https://www.hl7.org/fhir/task.html'
    },
    {
        name: 'ValueSet',
        description: 'A ValueSet resource instance specifies a set of codes drawn from one or more code systems, intended for use in a particular context. Value sets link between CodeSystem definitions and their use in coded elements.',
        url: 'http://hl7.org/fhir/valueset.html'
    },
];

export {resourceDefinitions};


