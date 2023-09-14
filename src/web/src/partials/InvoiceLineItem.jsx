import React from 'react';
import {Typography, Table, TableHead, TableBody, TableRow, TableCell, Box} from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';
import InvoicePriceComponent from './InvoicePriceComponent';

const InvoiceLineItem = ({ name, lineItems }) => {
    if (!Array.isArray(lineItems)) {
        lineItems = [lineItems];
    }
    if (lineItems && lineItems.length > 0 && lineItems[0]) {
        return (
            <Box>
                <Typography variant="h4">{name}</Typography>
                <Table className="table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Item</TableCell>
                            <TableCell>Code</TableCell>
                            <TableCell>Price Component</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {lineItems.map((lineItem) => {
                            return (
                                <TableRow key={lineItem.chargeItemReference.reference}>
                                    <TableCell>{lineItem.chargeItemReference.reference}</TableCell>
                                    <TableCell>
                                        <CodeableConcept resourceType="" codeableConcepts={lineItem.chargeItemCodeableConcept} name="Code" searchParameter="" />
                                    </TableCell>
                                    <TableCell>
                                        <InvoicePriceComponent name="" priceComponents={lineItem.priceComponent} />
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

export default InvoiceLineItem;
