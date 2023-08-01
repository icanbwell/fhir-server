import React, {useEffect, useState} from 'react';
import {useLocation, useParams} from 'react-router-dom';
import {Container, Box, Card, CardContent, CardHeader, Accordion} from '@mui/material';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import FhirApi from '../fhirApi';
import ResourceHeader from '../partials/ResourceHeader';
import ResourceItem from './ResourceItem';
import Json from '../partials/Json';
import SearchForm from '../partials/SearchForm';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Typography from '@mui/material/Typography';

/**
 * IndexPage
 * Note: Any route parameters are available via useParams()
 * @returns {Element}
 * @constructor
 */
const IndexPage = () => {
    const [resources, setResources] = useState('');
    const [bundle, setBundle] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [queryParameters, setQueryParameters] = useState([]);

    const {id, resourceType} = useParams();

    const [expanded, setExpanded] = useState(false);

    const handleExpand = () => {
        setExpanded(!expanded);
    };

    const location = useLocation();
    const queryString = location.search;

    console.log(`resourceType: ${resourceType}`);

    const getMain = () => {
        return resources.map((fullResource, index) => {
            const resource = fullResource.resource || fullResource;
            return (
                <Card key={index}>
                    <CardHeader title={`(${index + 1}) ${resource.resourceType}/${resource.id}`}>
                    </CardHeader>
                    <CardContent>
                        <ResourceHeader resource={resource}/>
                        <ResourceItem resourceType={resource.resourceType} resource={resource} index={index}/>
                        <Json index={index} resource={resource}/>
                    </CardContent>
                </Card>
            );
        });
    };

    useEffect(() => {
        const callApi = async () => {
            try {
                setLoading(true);
                document.title = 'Helix FHIR Server';
                const fhirApi = new FhirApi();
                const {json, status} = await fhirApi.getBundleAsync(
                    {
                        resourceType,
                        id,
                        queryString,
                        queryParameters
                    }
                );
                // noinspection JSCheckFunctionSignatures
                setStatus(status);
                if (json.entry) {
                    setResources(json.entry);
                    setBundle(json);
                    document.title = resourceType;
                } else {
                    // noinspection JSCheckFunctionSignatures
                    setResources(json ? [json] : []);
                    if (json.id) {
                        document.title = `${json.id} (${resourceType})`;
                    } else {
                        document.title = 'Helix FHIR Server';
                    }
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        callApi().catch(console.error);
    }, [id, queryString, queryParameters, resourceType]);

    /**
     * Handle search event from child component
     * @param {SearchFormQuery} searchFormQuery
     */
    const handleSearch = (searchFormQuery) => {
        // You can handle the event and data here
        console.log("Child button clicked!", searchFormQuery);
        setQueryParameters(searchFormQuery.getQueryParameters());
    };

    return (
        <Container maxWidth={false}>
            <Header resources={resources}/>
            <Accordion expanded={expanded} onChange={handleExpand}>
                <AccordionSummary
                    expandIcon={<ExpandMoreIcon/>}
                    aria-controls={`searchCollapse`}
                    id={`searchAccordion`}
                >
                    <Typography>Advanced Search</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <SearchForm onSearch={handleSearch}></SearchForm>
                </AccordionDetails>
            </Accordion>
            <Box my={2}>
                {loading ? '' : status === 200 ? getMain() : <div>Not Found</div>}
            </Box>
            {bundle && <Footer url={bundle.url} meta={bundle.meta}/>}
        </Container>
    );
};

export default IndexPage;
