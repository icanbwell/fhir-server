# Patient Data View Control

If there is any specific resources, that the patient needs to exclude from their patient $everything operation, a data view control Consent resource can be made for same. For any resource that is referenced in the Consent, will be excluded from the result.

Data is excluded for patient scoped request only and person inside jwt is matched with the [proxy patient](proxyPatient.md) in `patient.reference` field.

## Format of Consent

- `patient.reference` should contain uuid reference of proxy patient.
- `provision.data.reference` should contain uuid reference of patient whose linked resource needs to be excluded.
- `provision.provision.data.reference` should contain the reference of resource that needs to be excluded from $everything operation.
- `category.coding` should contain following element:
```
{
  "system": "http://www.icanbwell.com/consent-category",
  "code": "dataConnectionViewControl"
}
```

Example Consent Resource for excluding resources
```
{
  "resourceType": "Consent",
  "id": "924c184e-b830-550b-9296-6480ac5a2df2",
  "meta": {...},
  "status": "active",
  "scope": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/consentscope",
        "code": "patient-privacy"       
      }
    ]
  },
  "category": [
    {
      "coding": [
        {
          "system": "http://www.icanbwell.com/consent-category",
          "code": "dataConnectionViewControl"
        }
      ]
    }
  ],
  "patient": {
    "reference": "Patient/person.f31193f4-95c0-4218-aa7d-a4dc86f4860a"
  },
  "provision": {
    "actor": [
      {
        "id": "Patient/3c776efa-e42f-4351-a850-fdc203a2bf5f",
        "role": {
          "coding": {
            "code": "dependents"
          }
        },
        "reference": {
          "reference": "Patient/3c776efa-e42f-4351-a850-fdc203a2bf5f"
        }
      }
    ],
    "data": [
      {
        "id": "4c4b97e8-29cf-58db-9edd-f8136d19ceb2",
        "meaning": "instance",
        "reference": {
          "reference": "Encounter/24753e41-956d-4c4a-86f4-130920d7ea68"
        }
      }
      //...any more excluded resources
    ]
  }
}
```

Patient $everything request using patient jwt for above consent: `<base_url>/Patient/3c776efa-e42f-4351-a850-fdc203a2bf5f/$everything`. The Encounter resource with id `24753e41-956d-4c4a-86f4-130920d7ea68` will be excluded from the result of patient $everything operation.
