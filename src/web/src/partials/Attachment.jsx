import React, {useState, useEffect} from "react";
import {Accordion, AccordionSummary, AccordionDetails, Typography, Box} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const Attachment = ({value}) => {
    const [items, setItems] = useState([]);

    useEffect(() => {
        if (value && !Array.isArray(value)) {
            setItems([value]);
        } else {
            setItems(value);
        }
    }, [value]);

    const asciiToString = (ascii) => {
        if (!ascii) return '';
        const bytes = new Uint8Array(ascii.length);
        for (let i = 0; i < ascii.length; i++) {
            bytes[i] = ascii.charCodeAt(i);
        }
        return Buffer.from(bytes.buffer).toString('base64');
    };

    return (
        <>
            {items && items.length > 0 && items[0] && items.map((item, index) => (
                <Accordion key={index}>
                    <AccordionSummary
                        expandIcon={<ExpandMoreIcon/>}
                        aria-controls={`panel${index}-content`}
                        id={`panel${index}-header`}
                    >
                        <Typography>Content: {item.contentType}</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <Box component="pre">
                            <Box component="code">
                                {asciiToString(item.data)}
                            </Box>
                        </Box>
                    </AccordionDetails>
                </Accordion>
            ))}
        </>
    );
}

export default Attachment;
