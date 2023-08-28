import {Typography, Box} from '@mui/material';
import NameValue from '../partials/NameValue';
import CodeableConcept from '../partials/CodeableConcept';
import Timing from '../partials/Timing';

const Dosage = ({dosages, name}) => {
    return (
        <>
            {dosages && dosages.length > 0 && dosages[0] && (
                <Box>
                    <Typography variant="h4">{name}</Typography>
                    {dosages.map((dosage, index) => (
                        <Box key={index}>
                            <Typography variant="h5">
                                Sequence {dosage.sequence || ''}
                            </Typography>
                            <NameValue value={dosage.text} name="Text"/>
                            <CodeableConcept
                                resourceType=""
                                codeableConcepts={dosage.additionalInstruction}
                                name="Additional Instruction"
                                searchParameter=""
                            />
                            <NameValue
                                value={dosage.patientInstruction}
                                name="Patient Instruction"
                            />
                            <Timing timing={dosage.timing} name="Timing"/>
                            <NameValue value={dosage.asNeededBoolean} name="As Needed"/>
                            <CodeableConcept
                                resourceType=""
                                codeableConcepts={dosage.asNeededCodeableConcept}
                                name="As Needed"
                                searchParameter=""
                            />
                            <CodeableConcept
                                resourceType=""
                                codeableConcepts={dosage.site}
                                name="Site"
                                searchParameter=""
                            />
                            <CodeableConcept
                                resourceType=""
                                codeableConcepts={dosage.route}
                                name="Route"
                                searchParameter=""
                            />
                            <CodeableConcept
                                resourceType=""
                                codeableConcepts={dosage.method}
                                name="Method"
                                searchParameter=""
                            />

                            {dosage.doseAndRate &&
                                dosage.doseAndRate.map((dose, doseIndex) => (
                                    <CodeableConcept
                                        key={doseIndex}
                                        resourceType=""
                                        codeableConcepts={dose.type}
                                        name="Type"
                                        searchParameter=""
                                    />
                                ))}
                        </Box>
                    ))}
                </Box>
            )}
        </>
    );
};

export default Dosage;
