import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography } from '@mui/material';

function Table({name, rows, columns}) {
    if (!Array.isArray(rows)) {
        rows = [rows];
    }

    if (rows && rows.length > 0 && rows[0]) {
        return (
            <div>
                <Typography variant="h4">{name}</Typography>
                <TableContainer component={Paper}>
                    <Table className="table" aria-label="simple table">
                        <TableHead>
                            <TableRow>
                                {columns.map((column) => (
                                    <TableCell key={column}>{column}</TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row, rowIndex) => (
                                <TableRow key={rowIndex}>
                                    {columns.map((column, columnIndex) => (
                                        <TableCell key={`${rowIndex}-${columnIndex}`}>{row[column]}</TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        );
    } else {
        return null;
    }
}

export default Table;
