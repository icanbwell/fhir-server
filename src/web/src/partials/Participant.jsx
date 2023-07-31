import React from 'react';
import { Typography, Table, TableHead, TableBody, TableRow, TableCell, Link } from '@mui/material';

const Participant = ({ name, participants }) => {
    if (!Array.isArray(participants)) {
        participants = [participants];
    }
    if (participants && participants.length > 0 && participants[0]) {
        return (
            <div>
                <Typography variant="h4">{name}</Typography>
                <Table className="table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Actor</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Text</TableCell>
                            <TableCell>Code System</TableCell>
                            <TableCell>Code</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {participants.map((participant) => {
                            if (participant && participant.type) {
                                return participant.type.map((type) => {
                                    if (type.coding) {
                                        return type.coding.map((coding) => (
                                            <TableRow key={coding.code}>
                                                <TableCell>
                                                    <Link href={`/4_0_0/${participant.actor.reference}`}>
                                                        {participant.actor.reference}
                                                    </Link>
                                                </TableCell>
                                                <TableCell>{participant.status}</TableCell>
                                                <TableCell>{participant.type.text}</TableCell>
                                                <TableCell>{coding.system}</TableCell>
                                                <TableCell>{coding.code}</TableCell>
                                            </TableRow>
                                        ));
                                    } else {
                                        return null;
                                    }
                                });
                            } else {
                                return (
                                    <TableRow key={participant.actor.reference}>
                                        <TableCell>
                                            <Link href={`/4_0_0/${participant.actor.reference}`}>
                                                {participant.actor.reference}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{participant.status}</TableCell>
                                        <TableCell></TableCell>
                                        <TableCell></TableCell>
                                        <TableCell></TableCell>
                                    </TableRow>
                                );
                            }
                        })}
                    </TableBody>
                </Table>
            </div>
        );
    } else {
        return null;
    }
};

export default Participant;
