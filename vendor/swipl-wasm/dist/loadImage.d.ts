import type SWIPL_TYPE from './common';
export declare function loadImage(image: string | Buffer | Uint8Array, swipl: typeof SWIPL_TYPE): (options?: Partial<EmscriptenModule> | undefined) => Promise<SWIPL_TYPE.SWIPLModule>;
