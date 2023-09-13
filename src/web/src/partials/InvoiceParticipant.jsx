import React from 'react';
import {Typography, Table, TableHead, TableBody, TableRow, TableCell, Box} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';

const InvoiceParticipant = ({ name, participants }) => {
    if (!Array.isArray(participants)) {
        participants = [participants];
    }
    if (participants && participants.length > 0 && participants[0]) {
        return (
            <Box>
                <Typography variant="h4">{name}</Typography>
                <Table className="table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Role</TableCell>
                            <TableCell>Actor</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {participants.map((participant) => {
                            return (
                                <TableRow key={participant.id}>
                                    <TableCell>{participant.id}</TableCell>
                                    <TableCell>
                                        <CodeableConcept resourceType="" codeableConcepts={participant.role} name="" searchParameter="" />
                                    </TableCell>
                                    <TableCell>
                                        <Reference name="" references={participant.actor} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>
        );
    } else {
        return null;
    }
};

export default InvoiceParticipant;
