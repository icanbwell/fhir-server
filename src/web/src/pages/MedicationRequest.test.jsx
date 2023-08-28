import {render, screen} from '@testing-library/react'
import '@testing-library/jest-dom'
import medicationRequestResource from './test_fixtures/medicationRequest.json'
import nock from 'nock';
import MedicationRequest from './MedicationRequest';
import {MemoryRouter} from 'react-router-dom';

test('loads and displays greeting', async () => {
    // ARRANGE
    render(
        <MemoryRouter initialEntries={['/4_0_0/MedicationRequest']}>
            <MedicationRequest resource={medicationRequestResource.entry[0].resource}/>
        </MemoryRouter>
    );

    // ACT
    await screen.findByText('Patient/0003694e-6019-4f5c-a09d-1d740a6c4ea5');
});
