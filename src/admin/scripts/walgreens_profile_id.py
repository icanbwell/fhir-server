import os
import re
import requests
from pymongo import MongoClient

# Requires the PyMongo package.
# https://api.mongodb.com/python/current

client = MongoClient(os.environ['MONGO_URL'])
profile_filter = {
    'meta.security': {
        '$elemMatch': {
            'system': 'https://www.icanbwell.com/owner', 
            'code': 'bwell'
        }
    }, 
    'identifier': {
        '$elemMatch': {
            'system': 'http://www.walgreens.com/profileid'
        }
    }
}
# bwell master person for walgreens
person_docs = list(client['fhir']['Person_4_0_0'].find(profile_filter))
print('Total bwell master Person: ', len(person_docs))
duplicate_profile_filter_count = 0
bwell_master_persion_without_patient = []
profile_id_list = []
profile_id_dict = {}
# Check for each duplicate person id
for doc in person_docs:
    doc_id = doc['id']
    for identifier in doc['identifier']:
        if identifier['system'] == 'http://www.walgreens.com/profileid' and 'value' in identifier:
            profile_id = identifier['value']
            if profile_id in profile_id_dict:
                profile_id_dict[profile_id]['count'] += 1
                profile_id_dict[profile_id]['person_ids'].append(doc['id'])
                duplicate_profile_filter_count += 1
            else:
                profile_id_dict[profile_id] = {
                    'count': 1,
                    'person_ids': [doc['id']],
                    'with_patient_ids': [],
                    'without_patient_ids': []
                }
            link_list = doc['link']
            if link_list:
                # Check patient link
                has_patient = False
                for link in link_list:
                    if link['target']['reference'].startswith('Patient'):
                        has_patient = True
                        profile_id_dict[profile_id]['with_patient_ids'].append(doc['id'])
                        break
                if not has_patient:
                    profile_id_dict[profile_id]['without_patient_ids'].append(doc['id'])
                    bwell_master_persion_without_patient.append(doc['id'])          
            break    
    
print(f'bwell person with duplicate Profile: {duplicate_profile_filter_count}')
print(f'bwell person without linked patient: {len(bwell_master_persion_without_patient)}')
print(f'bwell person without linked patient: ', ','.join(bwell_master_persion_without_patient))
print('profile_id|with patient(person ids)|without patient(person ids)')
deleted_person_ids = []
for profile_id, stats in profile_id_dict.items():
    print(profile_id, "|", ','.join(stats['with_patient_ids']), "|", ','.join(stats['without_patient_ids']))
    # Delete perso without direct linked patient
    for doc_id in stats['without_patient_ids']:
        url = f'https://fhir.staging.icanbwell.com/admin/deletePersonDataGraph?id={doc_id}'
        payload={}
        headers = {
            'Authorization': 'Bearer JWT'
        }
        response = requests.request("GET", url, headers=headers, data=payload)
        if response.status_code == 200:
            print('Deleted person id:', doc_id)
            deleted_person_ids.append(doc_id)
        else:
            print('Unable to delete status code:', response.status_code)
print('Deleted person ids:', deleted_person_ids)
