import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';

import Reference from '../partials/reference';

const QuestionnaireResponse = ({resource}) => {
    return (
        <>
            <Typography variant="h4">Active</Typography>
            <Typography variant="body1">{resource.active.toString()}</Typography>

            <Typography variant="h4">Status</Typography>
            <Typography variant="body1">{resource.status}</Typography>

            <Typography variant="h4">Authored</Typography>
            <Typography variant="body1">{resource.authored}</Typography>

            <Reference references={[resource.subject]} name="Subject"/>
            <Reference references={resource.basedOn} name="Based On"/>
            <Reference references={resource.partOf} name="Part Of"/>
            <Reference references={[resource.encounter]} name="Encounter"/>
            <Reference references={[resource.author]} name="Author"/>
            <Reference references={[resource.source]} name="Source"/>

            <div>
                <Typography variant="h4">Item</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>LinkId</TableCell>
                                <TableCell>Text</TableCell>
                                <TableCell>Answer</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {resource.item?.map((item) => (
                                <TableRow key={item.linkId}>
                                    <TableCell>{item.linkId}</TableCell>
                                    <TableCell>{item.text}</TableCell>
                                    <TableCell>
                                        {item.answer?.map((answer) => {
                                            if (answer) {
                                                if (answer.valueBoolean !== undefined) {
                                                    return answer.valueBoolean ? 'True' : 'False';
                                                }
                                                if (answer.valueDecimal) {
                                                    return answer.valueDecimal;
                                                }
                                                if (answer.valueInteger) {
                                                    return answer.valueInteger;
                                                }
                                                if (answer.valueDate) {
                                                    return answer.valueDate;
                                                }
                                                if (answer.valueDateTime) {
                                                    return answer.valueDateTime;
                                                }
                                                if (answer.valueTime) {
                                                    return answer.valueTime;
                                                }
                                                if (answer.valueString) {
                                                    return answer.valueString;
                                                }
                                                if (answer.valueUri) {
                                                    return answer.valueUri;
                                                }
                                            }
                                            return null;
                                        })}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        </>
    );
};

export default QuestionnaireResponse;
