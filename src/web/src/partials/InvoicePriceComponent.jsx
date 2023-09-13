import React from 'react';
import {Typography, Table, TableHead, TableBody, TableRow, TableCell, Link, Box} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import Money from '../partials/Money';

const InvoicePriceComponent = ({ name, priceComponents }) => {
    if (!Array.isArray(priceComponents)) {
        priceComponents = [priceComponents];
    }
    if (priceComponents && priceComponents.length > 0 && priceComponents[0]) {
        return (
            <Box>
                <Typography variant="h4">{name}</Typography>
                <Table className="table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Code</TableCell>
                            <TableCell>Amount</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {priceComponents.map((priceComponent) => {
                                return (
                                    <TableRow key={priceComponent.id}>
                                        <TableCell>{priceComponent.id}</TableCell>
                                        <TableCell>{priceComponent.type}</TableCell>
                                        <TableCell>
                                            <CodeableConcept resourceType="" codeableConcepts={priceComponent.code} name="Code" searchParameter="" />
                                        </TableCell>
                                        <TableCell>
                                            <Money name="" value={priceComponent.amount.value} />
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

export default InvoicePriceComponent;
