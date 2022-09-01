// from https://stackoverflow.com/questions/59495104/how-to-let-typescript-know-about-custom-jest-matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toHaveResponse: (expected: Object) => void;
        }
    }
}

// I am exporting nothing just so we can import this file
export {};
