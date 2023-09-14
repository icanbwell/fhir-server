import React from 'react';
import {Box} from '@mui/material';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import NameValue from '../partials/NameValue';
import Uri from '../partials/Uri';
import DateTime from '../partials/DateTime';
import Money from '../partials/Money';
import Markdown from '../partials/Markdown';
import InvoiceParticipant from "../partials/InvoiceParticipant";
import InvoiceLineItem from "../partials/InvoiceLineItem";
import InvoicePriceComponent from "../partials/InvoicePriceComponent";

const Invoice = ({resource}) => {
    let totalGrossValue;
    if (resource.totalGross) {
        totalGrossValue = resource.totalGross.value;
    }
    let totalNetValue;
    if (resource.totalNet) {
        totalNetValue = resource.totalNet.value;
    }
    return (
        <Box>
            <Reference references={resource.subject} name="Subject" />
            <Reference references={resource.issuer} name="Issuer" />
            <Reference references={resource.recipient} name="Recipient" />
            <Reference references={resource.account} name="Account" />
            <DateTime name="Date" value={resource.date} />
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.type} name="Type" searchParameter="" />
            <NameValue value={resource.name} name="Name" />
            <Uri value={resource.address} name="URL" />
            <Code value={resource.status} name="Status" />
            <Money value={totalGrossValue} name="Total Gross Value" />
            <Money value={totalNetValue} name="Total Net Value" />
            <NameValue value={resource.cancelledReason} name="Cancelled Reason" />
            <Markdown value={resource.paymentTerms} name="Payment Terms" />
            <InvoiceParticipant name="Participants" participants={resource.participant} />
            <InvoiceLineItem name="Line Items" lineItems={resource.lineItem} />
            <InvoicePriceComponent name="Total Price Component" priceComponents={resource.totalPriceComponent} />
        </Box>
    );
}

export default Invoice;

