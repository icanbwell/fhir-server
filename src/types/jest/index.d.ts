// from https://stackoverflow.com/questions/59495104/how-to-let-typescript-know-about-custom-jest-matchers
declare namespace jest {
    // noinspection JSUnusedGlobalSymbols
    interface Matchers<R> {
        toHaveResponse(expected: Object): R
    }
}


// I am exporting nothing just so we can import this file
export {};
