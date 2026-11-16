ALTER TABLE fhir.Resource_4_0_0_History
    MODIFY SETTING parts_to_delay_insert = 2000, parts_to_throw_insert = 5000;
