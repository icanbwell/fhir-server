import os
import requests
from pymongo import MongoClient

# Requires the PyMongo package.
# https://api.mongodb.com/python/current
# export MONGO_URL=<URL with credentails>

client = MongoClient(os.environ['MONGO_URL'])
profile_filter = {
    'link': {
        '$elemMatch': {
            'target.reference': re.compile(r"^Patient")
        }
    }, 
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
                for link in link_list:
                    if link['target']['reference'].startswith('Patient'):
                        profile_id_dict[profile_id]['with_patient_ids'].append(doc['id'])
                        break
            break    
    
print('profile_id|duplicate person ids')
deleted_person_ids = []
for profile_id, stats in profile_id_dict.items():
    if stats['count'] > 1:
        print(profile_id, "|", ','.join(stats['with_patient_ids']))
        
        
