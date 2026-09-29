'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { handleLogout } = require('../../../routeHandlers/logout');

describe('handleLogout', () => {
    test('clears jwt cookie', () => {
        const res = { clearCookie: jestObj.fn(), redirect: jestObj.fn() };
        handleLogout({}, res);
        expect(res.clearCookie).toHaveBeenCalledWith('jwt');
    });

    test('redirects to root', () => {
        const res = { clearCookie: jestObj.fn(), redirect: jestObj.fn() };
        handleLogout({}, res);
        expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('clears cookie before redirecting', () => {
        const order = [];
        const res = {
            clearCookie: jestObj.fn(() => order.push('clear')),
            redirect: jestObj.fn(() => order.push('redirect'))
        };
        handleLogout({}, res);
        expect(order).toEqual(['clear', 'redirect']);
    });
});
