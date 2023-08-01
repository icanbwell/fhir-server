import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Link} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';

const CareTeam = ({resource}) => {
    const {name, status, resourceType, category, subject, participant} = resource;

    return (
        <div>
            <Typography variant="h4">Name</Typography>
            <Typography>{name}</Typography>

            <Typography variant="h4">Status</Typography>
            <Typography>{status}</Typography>

            <CodeableConcept resourceType={resourceType} codeableConcepts={category} name="Category"
                             searchParameter='category'/>
            <Reference references={[subject]} name="Subject"/>

            {participant && (
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Member</TableCell>
                                <TableCell>Role</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {participant.map((part, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        {part.member && (
                                            <Link href={`/4_0_0/${part.member.reference}`}>
                                                {part.member.reference}
                                            </Link>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {part.role && part.role.map((role, index) => (
                                            <React.Fragment key={index}>
                                                {role.coding && role.coding.map((coding, i) => (
                                                    <div key={i}>{coding.code} ({coding.display})</div>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </div>
    );
};

export default CareTeam;
