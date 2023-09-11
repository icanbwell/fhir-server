import React from 'react';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import ReferenceRange from '../partials/ReferenceRange';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Period from '../partials/Period';
import CodeableConceptWithValue from '../partials/CodeableConceptWithValue';
import {Box, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import Table from '../partials/Table';

function Observation({resource}) {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.category}
                name="Category"
                searchParameter='category'
            />
            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.code}
                name="Code"
                searchParameter='code'
            />
            <ReferenceRange
                referenceRange={resource.referenceRange}
                name="Reference Range"
            />
            <Reference
                references={[resource.subject]}
                name="Subject"
            />
            <Reference
                references={[resource.encounter]}
                name="Encounter"
            />

            <DateTime
                value={resource.effectiveDateTime}
                name="Effective Date"
            />
            <DateTime
                value={resource.issued}
                name="Issued Date"
            />
            <Period
                periods={resource.effectivePeriod}
                name="Effective Period"
            />
            <Reference
                references={resource.performer}
                name="Performer"
            />
            <CodeableConceptWithValue
                resourceType={resource.resourceType}
                codeableConceptsWithValue={resource.component}
                codePropertyName="code"
                name="Code"
                searchParameter='component-code'
            />
            <CodeableConceptWithValue
                resourceType={resource.resourceType}
                codeableConceptsWithValue={resource.valueCodeableConcept}
                codePropertyName="code"
                name="Value"
                searchParameter='value-concept'
            />

            <Typography variant="h4">Value</Typography>
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Type</TableCell>
                            <TableCell>Value</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {resource.valueString && (
                            <TableRow>
                                <TableCell>valueString</TableCell>
                                <TableCell>{resource.valueString}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueBoolean && (
                            <TableRow>
                                <TableCell>valueBoolean</TableCell>
                                <TableCell>{resource.valueBoolean?.toString()}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueInteger && (
                            <TableRow>
                                <TableCell>valueInteger</TableCell>
                                <TableCell>{resource.valueInteger}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueQuantity && resource.valueQuantity.value && (
                            <TableRow>
                                <TableCell>valueQuantity</TableCell>
                                <TableCell>{resource.valueQuantity.value} {resource.valueQuantity.unit}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueRange && (
                            <TableRow>
                                <TableCell>valueRange</TableCell>
                                <TableCell>{resource.valueRange.low.value} to {resource.valueRange.high.value}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueRatio && resource.valueRatio.numerator && resource.valueRatio.numerator.value && resource.valueRatio.denominator && resource.valueRatio.denominator.value && (
                            <TableRow>
                                <TableCell>valueRatio</TableCell>
                                <TableCell>{resource.valueRatio.numerator.value} / {resource.valueRatio.denominator.value}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueTime && (
                            <TableRow>
                                <TableCell>valueTime</TableCell>
                                <TableCell>{resource.valueTime}</TableCell>
                            </TableRow>
                        )}
                        {resource.valueDateTime && (
                            <TableRow>
                                <TableCell>valueDateTime</TableCell>
                                <TableCell>{resource.valueDateTime}</TableCell>
                            </TableRow>
                        )}
                        {resource.valuePeriod && (
                            <TableRow>
                                <TableCell>valuePeriod</TableCell>
                                <TableCell>{resource.valuePeriod.start} to {resource.valuePeriod.end}</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

        </Box>
    );
}

export default Observation;
