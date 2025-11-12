"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = strToBuffer;
/* eslint-disable no-param-reassign,no-plusplus,no-bitwise,no-use-before-define,no-multi-assign */
/* istanbul ignore file */
/**
 * A function that converts a string into a buffer.
 * This is required *only* for the conversion of the inlined
 * EYE_PVM string into a buffer
 * @param string The string to convert
 * @returns A Uint8Array Buffer
 */
function strToBuffer(data) {
    if (data.length % 4 === 0) {
        data = data.replace(/==?$/, '');
    }
    const output = [];
    let buffer = 0;
    let accumulatedBits = 0;
    for (let i = 0; i < data.length; i++) {
        buffer = (buffer << 6) | keystr.indexOf(data[i]);
        accumulatedBits += 1;
        if (accumulatedBits === 4) {
            output.push((buffer & 0xff0000) >> 16, (buffer & 0xff00) >> 8, buffer & 0xff);
            buffer = accumulatedBits = 0;
        }
    }
    if (accumulatedBits === 2) {
        output.push(buffer >> 4);
    }
    else if (accumulatedBits === 3) {
        output.push(((buffer >>= 2) & 0xff00) >> 8, buffer & 0xff);
    }
    // "Return output."
    return new Uint8Array(output);
}
/**
 * A lookup table for atob(), which converts an ASCII character to the
 * corresponding six-bit number.
 */
const keystr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
