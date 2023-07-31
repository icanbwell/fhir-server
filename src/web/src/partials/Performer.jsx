import React from "react";
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Link} from "@mui/material";

function Performer({performers, name}) {
    // Ensure performers is always an array
    const normalizedPerformers = Array.isArray(performers) ? performers : [performers];

    if (!normalizedPerformers.length || !normalizedPerformers[0]) {
        return null;
    }

    return (
        <div>
            <Typography variant="h4">{name}</Typography>
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Actor</TableCell>
                            <TableCell>Text</TableCell>
                            <TableCell>Code System</TableCell>
                            <TableCell>Code</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {normalizedPerformers.map((performer) => (
                            (performer.function && performer.function.type && performer.function.type.coding)
                                ? performer.function.type.coding.map((coding) => (
                                    <TableRow key={coding.code}>
                                        <TableCell>
                                            <Link
                                                href={`/4_0_0/${performer.actor.reference}`}>{performer.actor.reference}</Link>
                                        </TableCell>
                                        <TableCell>{performer.function.text}</TableCell>
                                        <TableCell>{coding.system}</TableCell>
                                        <TableCell>{coding.code}</TableCell>
                                    </TableRow>
                                ))
                                : <TableRow key={performer.actor.reference}>
                                    <TableCell>
                                        <Link
                                            href={`/4_0_0/${performer.actor.reference}`}>{performer.actor.reference}</Link>
                                    </TableCell>
                                    <TableCell></TableCell>
                                    <TableCell></TableCell>
                                    <TableCell></TableCell>
                                </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
}

export default Performer;
