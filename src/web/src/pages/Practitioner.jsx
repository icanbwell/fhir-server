import React from 'react';
import {Table, TableHead, TableBody, TableRow, TableCell, Typography, Box} from '@mui/material';
import ResourceHeader from '../partials/ResourceHeader';
import HumanNames from '../partials/HumanNames';
import CodeableConcept from '../partials/CodeableConcept';
import ContactPoint from '../partials/ContactPoint';
import ReverseReference from '../partials/ReverseReference';

function Practitioner({resource, index}) {
    return (
        <Box key={index}>
            <ResourceHeader res={resource}/>
            <HumanNames names={resource.name} resourceType={resource.resourceType}/>
            <Typography variant="h4">Gender</Typography>
            <Typography variant="body1">{resource.gender}</Typography>
            {resource.qualification && (
                <>
                    <Typography variant="h4">Qualifications</Typography>
                    <Table className="table">
                        <TableHead>
                            <TableRow>
                                <TableCell>Code</TableCell>
                                <TableCell>Display</TableCell>
                                <TableCell>System</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {resource.qualification.map((qualification, index) => {
                                if (qualification.code && qualification.code.coding) {
                                    return qualification.code.coding.map((coding, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{coding.code}</TableCell>
                                            <TableCell>{coding.display}</TableCell>
                                            <TableCell>{coding.system}</TableCell>
                                        </TableRow>
                                    ));
                                }
                                return null;
                            })}
                        </TableBody>
                    </Table>
                </>
            )}
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.communication}
                name="Communication"
                searchParameter="communication"
            />
            <ContactPoint resourceType={resource.resourceType} contacts={resource.telecom} name="Telecom"/>
            <ReverseReference
                reverseReferences={[{target: 'PractitionerRole', property: 'practitioner'}]}
                id={resource.id}
                name="Practitioner Role"
            />
            <ReverseReference
                reverseReferences={[{target: 'Schedule', property: 'actor'}]}
                id={resource.id}
                name="Schedule (also check schedules on PractitionerRole)"
            />
        </Box>
    );
}

export default Practitioner;
