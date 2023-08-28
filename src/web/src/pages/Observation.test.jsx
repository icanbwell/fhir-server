import {render, screen} from '@testing-library/react'
import '@testing-library/jest-dom'
import observationResource from './test_fixtures/observation.json'
import Observation from './Observation';
import {MemoryRouter} from 'react-router-dom';

test('load single Observation', async () => {
    // ARRANGE
    render(
        <MemoryRouter initialEntries={['/4_0_0/Observation/1fe909eb-662f-4e3f-b9c6-c0d84871e7e1']}>
            <Observation resource={observationResource}/>
        </MemoryRouter>
    );

    // ACT
    await screen.findByText('88148');
});
