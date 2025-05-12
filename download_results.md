# Download Search Results as Microsoft Excel file

In addition to receiving search results in JSON format, you can also download the search results in Microsoft Excel format. To do this, you can use the following URL:

```
GET https://api.bwellhealth.com/fhir/Patient/$search?_format=application/vnd.ms-excel
```
or you can pass the Accept header as `application/vnd.ms-excel`:

```
GET https://api.bwellhealth.com/fhir/Patient/$search
Accept: application/vnd.ms-excel
```
This will return a single Microsoft Excel file containing the search results. The Excel file will contain multiple sheets, each representing a different resource type associated with the search criteria.


This works for any search in the FHIR not just for Patient.


NOTE: This uses the fhir-to-csv library (https://github.com/icanbwell/fhir-to-csv) to convert the FHIR resources to CSV format. The library is designed to handle the conversion of FHIR resources to Excel format, and it supports various resource types and their associated fields.

## Google Sheets or Apple Numbers
You can open the Microsoft Excel file in Google Sheets or Apple Numbers. The file is compatible with these applications, and you can view and edit the data as needed.

