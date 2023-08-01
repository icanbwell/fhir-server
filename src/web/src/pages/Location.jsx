import React from "react";
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import ContactPoint from '../partials/ContactPoint';
import Address from '../partials/Address';
import Position from '../partials/Position';
import Reference from '../partials/Reference';
import ReverseReference from '../partials/ReverseReference';

function Location({resource}) {
    return (
        <div>
            <Typography variant="h4">Status</Typography>
            <Typography>{resource.status}</Typography>
            <Typography variant="h4">Name</Typography>
            <Typography>{resource.name}</Typography>
            <Typography variant="h4">Mode</Typography>
            <Typography>{resource.mode}</Typography>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.type} name="Type"
                             searchParameter='type'/>
            <ContactPoint resourceType={resource.resourceType} contacts={resource.telecom} name="Telecom"/>
            <Address resourceType={resource.resourceType} addresses={[resource.address]} name="Address"/>
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.physicalType]}
                             name="Physical Type" searchParameter=''/>
            <Position positions={[resource.position]} name="Position"/>
            <Reference references={[resource.managingOrganization]} name="Managing Organization"/>

            {resource.hoursOfOperation &&
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Days Of Week</TableCell>
                                <TableCell>Opening Time</TableCell>
                                <TableCell>Closing Time</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {resource.hoursOfOperation.map((hoursOfOperation) => (
                                <TableRow key={hoursOfOperation.id}>
                                    <TableCell>{hoursOfOperation.daysOfWeek.join(', ')}</TableCell>
                                    <TableCell>{hoursOfOperation.openingTime}</TableCell>
                                    <TableCell>{hoursOfOperation.closingTime}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            }

            <ReverseReference reverseReferences={[{target: 'PractitionerRole', property: 'location'}]} id={resource.id}
                              name="PractitionerRole"/>
            <ReverseReference reverseReferences={[{target: 'HealthcareService', property: 'location'}]} id={resource.id}
                              name="HealthcareService"/>
            <ReverseReference reverseReferences={[{target: 'Organization', property: 'location'}]} id={resource.id}
                              name="Organization"/>
            <ReverseReference reverseReferences={[{target: 'Schedule', property: 'location'}]} id={resource.id}
                              name="Schedule"/>
        </div>
    );
}

export default Location;
