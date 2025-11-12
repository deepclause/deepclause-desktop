/**
 * A function that converts a string into a buffer.
 * This is required *only* for the conversion of the inlined
 * EYE_PVM string into a buffer
 * @param string The string to convert
 * @returns A Uint8Array Buffer
 */
export default function strToBuffer(data: string): Uint8Array<ArrayBuffer>;
