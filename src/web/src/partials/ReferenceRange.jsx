import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';

const ReferenceRange = ({referenceRange, name}) => {
    referenceRange = Array.isArray(referenceRange) ? referenceRange : [referenceRange];

    return (
        referenceRange && referenceRange.length > 0 && referenceRange[0] ?
            <div>
                <Typography variant="h4">{name}</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>id</TableCell>
                                <TableCell>low</TableCell>
                                <TableCell>high</TableCell>
                                <TableCell>text</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {referenceRange.map((range, index) => (
                                range ?
                                    <TableRow key={index}>
                                        <TableCell>{range.id ? range.id : ''}</TableCell>
                                        <TableCell>{range.low && range.low.value ? `${range.low.value}${range.low.unit ? range.low.unit : ''}` : ''}</TableCell>
                                        <TableCell>{range.high && range.high.value ? `${range.high.value}${range.high.unit ? range.high.unit : ''}` : ''}</TableCell>
                                        <TableCell>{range.text ? range.text : ''}</TableCell>
                                    </TableRow> : null
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div> : null
    );
};

export default ReferenceRange;
