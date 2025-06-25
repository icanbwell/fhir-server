# Download Patient (or Person or Practioner) Summary

This b.well FHIR server supports the $summary operation for the Patient, Person, and Practitioner resources. This operation allows you to retrieve a summary of a patient's information in a single request in either CSV or Microsoft Excel format.

## Download as CSV
To download a summary of a patient in CSV format, you can use the following URL:

```
GET https://api.bwellhealth.com/fhir/Patient/{id}/$summary?_format=text/csv
```
or you can pass the Accept header as `text/csv`:

```
GET https://api.bwellhealth.com/fhir/Patient/{id}/$summary
Accept: text/csv
```
This will return a Zip file containing the CSV files for the patient. The Zip file will contain multiple CSV files, each representing a different resource type associated with the patient.

## Download as Microsoft Excel file
To download a summary of a patient in Microsoft Excel format, you can use the following URL:

```
GET https://api.bwellhealth.com/fhir/Patient/{id}/$summary?_format=application/vnd.ms-excel
```
or you can pass the Accept header as `application/application/vnd.ms-excel`:

```
GET https://api.bwellhealth.com/fhir/Patient/{id}/$summary
Accept: application/application/vnd.ms-excel
```
This will return a single Microsoft Excel file containing the summary of the patient. The Excel file will contain multiple sheets, each representing a different resource type associated with the patient.


NOTE: This uses the fhir-to-csv library (https://github.com/icanbwell/fhir-to-csv) to convert the FHIR resources to CSV format. The library is designed to handle the conversion of FHIR resources to Excel format, and it supports various resource types and their associated fields.

## Google Sheets or Apple Numbers
You can open the Microsoft Excel file in Google Sheets or Apple Numbers. The file is compatible with these applications, and you can view and edit the data as needed.

