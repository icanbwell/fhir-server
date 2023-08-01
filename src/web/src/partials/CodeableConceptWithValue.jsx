import React, {useState, useEffect} from "react";
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Link} from "@mui/material";

function CodeableConceptWithValue({name, codeableConceptsWithValue, codePropertyName, searchParameter, resourceType}) {
    const [codeableConcepts, setCodeableConcepts] = useState([]);

    useEffect(() => {
        if (!Array.isArray(codeableConceptsWithValue)) {
            setCodeableConcepts([codeableConceptsWithValue]);
        } else {
            setCodeableConcepts(codeableConceptsWithValue);
        }
    }, [codeableConceptsWithValue]);

    if (!(codeableConcepts && codeableConcepts.length > 0 && codeableConcepts[0])) {
        return null;
    }

    const handleCodingSystem = (coding) => {
        switch (coding.system) {
            case 'http://www.ama-assn.org/go/cpt':
                return `https://vsac.nlm.nih.gov/context/cs/codesystem/CPT/version/2022/code/${coding.code}/info`;
            case 'http://snomed.info/sct':
                return `https://vsac.nlm.nih.gov/context/cs/codesystem/SNOMEDCT/version/2022-03/code/${coding.code}/info`;
            case 'http://hl7.org/fhir/sid/cvx':
                return `https://vsac.nlm.nih.gov/context/cs/codesystem/CVX/version/2022-08-17/code/${coding.code}/info`;
            case 'http://hl7.org/fhir/sid/icd-10-cm':
            case 'http://hl7.org/fhir/sid/icd-10':
                const code = (coding.code.includes('.') || coding.code.length < 4) ? coding.code : coding.code.substr(0, 3) + '.' + coding.code.substr(3, 10);
                return `https://vsac.nlm.nih.gov/context/cs/codesystem/ICD10CM/version/2023/code/${code}/info`;
            case 'http://www.nlm.nih.gov/research/umls/rxnorm':
                return `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${coding.code}`;
            default:
                return coding.code;
        }
    };

    return (
        <React.Fragment>
            <Typography variant="h4">{name}</Typography>
            <TableContainer>
                <Table className="table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Text</TableCell>
                            <TableCell>Code System</TableCell>
                            <TableCell>Code</TableCell>
                            <TableCell>Value</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {codeableConcepts.map((concept) => {
                            if (concept && concept[codePropertyName] && concept[codePropertyName].coding) {
                                return concept[codePropertyName].coding.map((coding, i) => {
                                    if (coding) {
                                        const systemUrl = `/4_0_0/${resourceType}?${searchParameter}=${coding.system}|`;
                                        const codeUrl = `/4_0_0/${resourceType}?${searchParameter}=${coding.system}|${coding.code}`;
                                        const system = searchParameter ?
                                            <Link href={systemUrl}>{coding.system}</Link> : coding.system;
                                        const code = searchParameter ? <Link href={codeUrl}>{coding.code}</Link> :
                                            <Link href={handleCodingSystem(coding)}>{coding.code}</Link>;

                                        let value = "";
                                        if (concept.valueQuantity) {
                                            value = `${concept.valueQuantity.value} ${concept.valueQuantity.unit}`;
                                        } else if (concept.value) {
                                            value = concept.value;
                                        } else if (concept.valueString) {
                                            value = concept.valueString;
                                        } else if (concept.valueBoolean) {
                                            value = concept.valueBoolean;
                                        } else if (concept.valueInteger) {
                                            value = concept.valueInteger;
                                        } else if (concept.valueRange) {
                                            value = `${concept.valueRange.low} to ${concept.valueRange.high}`;
                                        }

                                        return (
                                            <TableRow key={i}>
                                                <TableCell>{concept[codePropertyName].text}</TableCell>
                                                <TableCell>{system}</TableCell>
                                                <TableCell>{code}</TableCell>
                                                <TableCell>{value}</TableCell>
                                            </TableRow>
                                        );
                                    } else {
                                        return null;
                                    }
                                });
                            } else {
                                return null;
                            }
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </React.Fragment>
    );
}

export default CodeableConceptWithValue;
