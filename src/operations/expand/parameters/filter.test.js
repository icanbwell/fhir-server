/**
 * simple test for the app
 */
const {filter} = require('./filter');
// const { app } = require('./app');
// const request = supertest(app);

describe('Valueset:Expand:Filter', () => {
  let valueSet = [
    {
      code: 'TestMaTchesTest on code'
    },
    {
      display: 'only matches on display'
    },
    {
      code: 'Doesn\'t match on code',
      display: 'matches on display'
    },
    {
      code: 'No match',
      display: 'No match'
    },
  ];
  let filterTerm = 'Matches';

  test('it should filter by code and display', async () => {
    const result = filter(valueSet, filterTerm);
    // const response = await request.get('/health');
    expect(result.length).toBe(3);
    expect(result[0]).toStrictEqual(
      {
        code: 'TestMaTchesTest on code'
      }
    );
    expect(result[1]).toStrictEqual(
      {
        display: 'only matches on display'
      }
    );
    expect(result[2]).toStrictEqual({
      code: 'Doesn\'t match on code',
      display: 'matches on display'
    });
  });
});
