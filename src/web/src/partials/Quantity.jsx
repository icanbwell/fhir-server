import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';

function Quantity({value = [], name = ''}) {
    if (!Array.isArray(value)) {
        value = [value];
    }

    if (value && value.length > 0 && value[0]) {
        return (
            <div>
                <Typography variant="h4">{name}</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>comparator</TableCell>
                                <TableCell>value</TableCell>
                                <TableCell>unit</TableCell>
                                <TableCell>system</TableCell>
                                <TableCell>code</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {value.map((quantity, i) => (
                                <TableRow key={i}>
                                    <TableCell>{quantity.comparator}</TableCell>
                                    <TableCell>{quantity.value}</TableCell>
                                    <TableCell>{quantity.unit}</TableCell>
                                    <TableCell>{quantity.system}</TableCell>
                                    <TableCell>{quantity.code}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        );
    }

    // Render nothing if no valid data is provided
    return null;
}

export default Quantity;
