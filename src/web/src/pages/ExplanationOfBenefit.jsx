import React from 'react';
import {Typography, Link, Box, TableContainer, Table, TableHead, TableRow, TableCell, TableBody} from '@mui/material';
import Code from '../partials/Code';
import Reference from '../partials/Reference';
import CodeableConcept from '../partials/CodeableConcept';
import Paper from '@mui/material/Paper';

const DomainResource = ({resource, admin, index}) => {

    // Function to render coding
    const renderCoding = (coding) => {
        let code = coding.code;
        const system = coding.system.split('/').pop();
        let href;
        if (coding.system === 'http://www.ama-assn.org/go/cpt') {
            href = `https://vsac.nlm.nih.gov/context/cs/codesystem/CPT/version/2022/code/${code}/info`;
        } else if (coding.system === 'http://snomed.info/sct') {
            href = `https://vsac.nlm.nih.gov/context/cs/codesystem/SNOMEDCT/version/2022-03/code/${code}/info`;
        } else if (coding.system === 'http://hl7.org/fhir/sid/cvx') {
            href = `https://vsac.nlm.nih.gov/context/cs/codesystem/CVX/version/2022-08-17/code/${code}/info`;
        } else if (coding.system === 'http://hl7.org/fhir/sid/icd-10-cm' || coding.system === 'http://hl7.org/fhir/sid/icd-10') {
            code = (coding.code.includes('.') || coding.code.length < 4) ? coding.code : coding.code.substr(0, 3) + '.' + coding.code.substr(3, 10);
            href = `https://vsac.nlm.nih.gov/context/cs/codesystem/ICD10CM/version/2023/code/${code}/info`;
        }
        return href ? <a href={href}>{`${code} (${system})`}</a> : `${code} (${system})`;
    };

    // Function to render adjudication
    const renderAdjudication = (adjudicationArray, codeToMatch) => {
        const adjudication = adjudicationArray.filter(x => x.category && x.category.coding && x.category.coding.some(y => y.code === codeToMatch))[0];
        return adjudication ? adjudication.amount.value : '';
    };

    const codes = ['submittedamount', 'allowedamount', 'deductibleamount', 'coinsuranceamount', 'copayamount', 'noncoveredamount', 'cobamount', 'paymentamount', 'patientpayamount'];

    return (
        <Box>
            <Code value={resource.status} name="Status"/>
            <Code value={resource.outcome} name="Outcome"/>

            <Typography variant="h4">Created</Typography>
            <Typography variant="body1">{resource.created}</Typography>

            {resource.billablePeriod &&
                <>
                    <Typography variant="h4">Billable Period</Typography>
                    <Typography
                        variant="body1">{`${resource.billablePeriod.start} to ${resource.billablePeriod.end}`}</Typography>
                </>
            }

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={[resource.type]}
                             name="Type" searchParameter=''/>
            <Reference references={[resource.patient]} name="Patient"/>
            <Reference references={[resource.insurer]} name="Insurer"/>
            <Reference references={[resource.provider]} name="Provider"/>
            <Reference references={[resource.claim]} name="Claim"/>

            {resource.diagnosis &&
                <div>
                    <Typography variant="h4">Diagnosis</Typography>
                    <TableContainer component={Paper()}>
                        <Table className="table" aria-label="simple table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Type</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.diagnosis.map((diagnosisItem) => (
                                    <TableRow key={diagnosisItem.sequence}>
                                        <TableCell>{diagnosisItem.sequence}</TableCell>
                                        <TableCell>
                                            {diagnosisItem.diagnosisCodeableConcept && diagnosisItem.diagnosisCodeableConcept.coding.map(coding =>
                                                <div key={coding.code}>
                                                    {coding.code && (coding.system === 'http://hl7.org/fhir/sid/icd-10-cm' || coding.system === 'http://hl7.org/fhir/sid/icd-10')
                                                        ? <Link
                                                            href={`https://vsac.nlm.nih.gov/context/cs/codesystem/ICD10CM/version/2023/code/${(coding.code.includes('.') || coding.code.length < 4) ? coding.code : coding.code.substr(0, 3) + '.' + coding.code.substr(3, 10)}/info`}>{coding.code}</Link>
                                                        : `${coding.code} (${coding.system.split('/').pop()})`
                                                    }
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {diagnosisItem.type && diagnosisItem.type.map(type =>
                                                type.coding.map(coding =>
                                                    <div
                                                        key={coding.code}>{`${coding.code} (${coding.system.split('/').pop()})`}</div>
                                                )
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            }

            {resource.procedure && (
                <div>
                    <Typography variant="h4">Procedure</Typography>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Code</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.procedure.map((procedure) => (
                                    <TableRow key={procedure.sequence}>
                                        <TableCell>{procedure.sequence}</TableCell>
                                        <TableCell>
                                            {procedure.procedureCodeableConcept && procedure.procedureCodeableConcept.coding.map((coding) => (
                                                renderCoding(coding)
                                            ))}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}

            {resource.item && (
                <div>
                    <Typography variant="h4">Items</Typography>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Date</TableCell>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Quantity</TableCell>
                                    <TableCell>Revenue</TableCell>
                                    <TableCell>Submitted</TableCell>
                                    <TableCell>Allowed</TableCell>
                                    <TableCell>Deductible</TableCell>
                                    <TableCell>Coinsurance</TableCell>
                                    <TableCell>CoPay</TableCell>
                                    <TableCell>Non-covered</TableCell>
                                    <TableCell>COB</TableCell>
                                    <TableCell>Payment</TableCell>
                                    <TableCell>Patient</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.item.map((item) => (
                                    <TableRow key={item.sequence}>
                                        <TableCell>{item.sequence}</TableCell>
                                        <TableCell>
                                            {item.servicedDate || (item.servicedPeriod.start !== item.servicedPeriod.end ? `${item.servicedPeriod.start} - ${item.servicedPeriod.end}` : item.servicedPeriod.start)}
                                        </TableCell>
                                        <TableCell>
                                            {item.productOrService && item.productOrService.coding.map((coding) => (
                                                renderCoding(coding)
                                            ))}
                                        </TableCell>
                                        <TableCell>
                                            {item.quantity && item.quantity.value}
                                        </TableCell>
                                        <TableCell>
                                            {item.revenue && item.revenue.coding.map((coding) => (
                                                coding.code
                                            ))}
                                        </TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'submittedamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'allowedamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'deductibleamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'coinsuranceamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'copayamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'noncoveredamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'cobamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'paymentamount')}</TableCell>
                                        <TableCell>{item.adjudication && renderAdjudication(item.adjudication, 'patientpayamount')}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}

            {resource.adjudication && (
                <div>
                    <Typography variant="h4">Adjudication</Typography>
                    <TableContainer component={Paper}>
                        <Table sx={{minWidth: 650}} aria-label="simple table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Submitted</TableCell>
                                    <TableCell>Allowed</TableCell>
                                    <TableCell>Deductible</TableCell>
                                    <TableCell>Coinsurance</TableCell>
                                    <TableCell>CoPay</TableCell>
                                    <TableCell>Non-covered</TableCell>
                                    <TableCell>COB</TableCell>
                                    <TableCell>Payment</TableCell>
                                    <TableCell>Patient</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow>
                                    {codes.map((code) => (
                                        <TableCell key={code}>
                                            {resource.adjudication
                                                .filter((x) => x.category && x.category.coding && x.category.coding.some((y) => y.code === code))
                                                .map((adjudication) => adjudication.amount.value)
                                            }
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}
            {resource.careTeam && (
                <div>
                    <Typography variant="h4">Care Team</Typography>
                    <TableContainer component={Paper}>
                        <Table sx={{minWidth: 650}} aria-label="simple table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Provider</TableCell>
                                    <TableCell>Role</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.careTeam.map((item) => (
                                    <TableRow key={item.sequence}>
                                        <TableCell>{item.sequence}</TableCell>
                                        <TableCell>
                                            {item.provider && item.provider.reference &&
                                                <a href={`/4_0_0/${item.provider.reference}`}>{item.provider.reference}</a>
                                            }
                                        </TableCell>
                                        <TableCell>
                                            {item.role && item.role.coding &&
                                                item.role.coding.map(coding => `${coding.code} (${coding.system.split('/').pop()})`).join(', ')
                                            }
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}

            {resource.insurance && (
                <div>
                    <Typography variant="h4">Insurance</Typography>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Focal</TableCell>
                                    <TableCell>Coverage</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.insurance.map((item) => (
                                    <TableRow key={item.focal}>
                                        <TableCell>{item.focal}</TableCell>
                                        <TableCell>
                                            <a href={`/4_0_0/${item.coverage.reference}`}>
                                                {item.coverage.reference}
                                            </a>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}
            {resource.total && (
                <div>
                    <Typography variant="h4">Totals</Typography>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>id</TableCell>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Currency</TableCell>
                                    <TableCell>Amount</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.total.map((total) => (
                                    <TableRow key={total.id}>
                                        <TableCell>{total.id}</TableCell>
                                        <TableCell>
                                            {total.category && total.category.coding &&
                                                total.category.coding.map(coding =>
                                                    coding.system ? `${coding.code} (${coding.system.split('/').pop()})` : null
                                                )}
                                        </TableCell>
                                        <TableCell>
                                            {total.amount && total.amount.currency}
                                        </TableCell>
                                        <TableCell>
                                            {total.amount && total.amount.value}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}
            {resource.supportingInfo && (
                <div>
                    <Typography variant="h4">Supporting Info</Typography>
                    <TableContainer component={Paper}>
                        <Table aria-label="simple table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Value</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.supportingInfo.map((item) => (
                                    <TableRow key={item.sequence}>
                                        <TableCell component="th" scope="row">
                                            {item.sequence}
                                        </TableCell>
                                        <TableCell>
                                            {item.category && item.category.coding &&
                                                item.category.coding.map((coding) => coding.system ? `${coding.code} (${coding.system.split('/').pop()})` : null).join(', ')
                                            }
                                        </TableCell>
                                        <TableCell>
                                            {item.valueQuantity ? item.valueQuantity.value :
                                                item.code && item.code.coding && item.code.coding.length > 0 ?
                                                    item.code.coding.map((coding) => `${coding.code}${item.valueString ? ` (${item.valueString})` : ''}`).join(', ')
                                                    :
                                                    item.valueString || null
                                            }
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </div>
            )}
        </Box>
    );
};

export default DomainResource;
