/**
 * simple test for the app
 */
const {createTestRequest} = require('./tests/common');
const request = createTestRequest();
const {describe, expect} = require('@jest/globals');


describe('#app', () => {
  test('it should startup and return health check status ok', async () => {
    const response = await request.get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });
});
