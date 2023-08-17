import {render, screen} from '@testing-library/react'
import '@testing-library/jest-dom'
import MedicationRequest from './MedicationRequest'
import medicationRequestResource from './test_fixtures/medicationRequest.json'

test('loads and displays greeting', async () => {
    // ARRANGE
    render(<MedicationRequest resource={medicationRequestResource}/>);

    // ACT
});
