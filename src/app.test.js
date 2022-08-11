/**
 * simple test for the app
 */
const supertest = require('supertest');

const { app } = require('./app');
const request = supertest(app);
const {describe, expect} = require('@jest/globals');

describe('#app', () => {
  test('it should startup and return health check status ok', async () => {
    const response = await request.get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });
});
