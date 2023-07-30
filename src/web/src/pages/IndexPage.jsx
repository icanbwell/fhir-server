// Importing the required components
import Head from '../partials/Head';
import Header from '../partials/Header';
// import ResourceItem from '../partials/ResourceItem';
// import Footer from '../partials/Footer';
import {useEffect, useState} from 'react';
import FhirApi from '../fhirApi';
import AccountPage from './AccountPage';

// Main Component
const IndexPage = () => {
    const [
        /** @type {Object[]} */ resources,
        setResources
    ] = useState('');


    useEffect(() => {
        const callApi = async () => {
            try {
                const patientId = `john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3`;
                const fhirApi = new FhirApi();
                const data = await fhirApi.getResource({id: patientId});
                console.log('Account Page received data');
                console.log(data);
                if (data.entry) {
                    setResources(data.entry);
                } else {
                    setResources([data]);
                }
            } catch (error) {
                console.error(error);
            }
        };
        callApi()
            // make sure to catch any error
            .catch(console.error);
    }, []);

    return (
        <html lang="en">
        <head>
            <Head/>
        </head>
        <body className="container-fluid p-0">
        <Header resources={resources}/>
        <main>
            {resources && resources.map((fullResource, index) => {
                const res = fullResource.resource || fullResource;
                return (
                    // <ResourceItem
                    //     key={index}
                    //     res={res}
                    //     fullResource={fullResource}
                    //     index={index}
                    // />
                    // <div>id: {res.id}</div>
                    <AccountPage resource={res}/>
                );
            })}
        </main>
        {/*<Footer url={url} meta={meta}/>*/}
        </body>
        </html>
    );
};

export default IndexPage;
