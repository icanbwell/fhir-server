import React, {useEffect, useState} from 'react';
import {useLocation, useParams} from 'react-router-dom';
import {Container, Box} from '@mui/material';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import FhirApi from '../fhirApi';
import ResourceHeader from '../partials/ResourceHeader';
import ResourceItem from './ResourceItem';
import Json from '../partials/Json';

// Main Component
const IndexPage = () => {
    const [resources, setResources] = useState('');
    const [bundle, setBundle] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);

    const {id} = useParams();
    const location = useLocation();
    const queryString = location.search;

    const getMain = () => {
        return resources.map((fullResource, index) => {
            const resource = fullResource.resource || fullResource;
            return (
                <React.Fragment key={index}>
                    <ResourceHeader resource={resource}/>
                    <ResourceItem resource={resource} index={index}/>
                    <Json index={index} resource={resource}/>
                </React.Fragment>
            );
        });
    };

    useEffect(() => {
        const callApi = async () => {
            try {
                setLoading(true);
                document.title = 'Helix FHIR Server';
                const resourceType = 'Practitioner';
                const fhirApi = new FhirApi();
                const {json, status} = await fhirApi.getBundleAsync({resourceType, id, queryString});
                setStatus(status);
                if (json.entry) {
                    setResources(json.entry);
                    setBundle(json);
                    document.title = resourceType;
                } else {
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
    }, [id, queryString]);

    return (
        <Container maxWidth={false}>
            <Header resources={resources}/>
            <Box my={2}>
                {!loading && status === 200 ? getMain() : <div>Not Found</div>}
            </Box>
            {bundle && <Footer url={bundle.url} meta={bundle.meta}/>}
        </Container>
    );
};

export default IndexPage;
