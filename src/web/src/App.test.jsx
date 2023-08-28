import {render, screen} from '@testing-library/react'
import '@testing-library/jest-dom'
import medicationRequestResource from './pages/test_fixtures/medicationRequest.json'
import nock from 'nock';
import App from './App';

test('loads and displays greeting', async () => {
    nock('http://localhost:8080')
        .get('/4_0_0/MedicationRequest?_count=10')
        .reply(200, medicationRequestResource);
    // ARRANGE
    render(<App/>);

    // ACT
    await screen.findByText('Helix FHIR Server');
});
