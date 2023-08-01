import React, {useState} from "react";
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const Json = ({index, resource}) => {
    const [expanded, setExpanded] = useState(false);

    const handleExpand = () => {
        setExpanded(!expanded);
    };

    return (
        <Accordion expanded={expanded} onChange={handleExpand}>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon/>}
                aria-controls={`jsonCollapse${index}`}
                id={`jsonAccordion${index}`}
            >
                <Typography>Raw Json</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Typography>
                    <h4>Raw Json</h4>
                    (Use _format=json on url if you want JUST the raw json)
                    <pre>
            <code>
              {JSON.stringify(resource, null, 4)}
            </code>
          </pre>
                </Typography>
            </AccordionDetails>
        </Accordion>
    );
};

export default Json;
