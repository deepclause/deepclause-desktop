import SWIPL from './swipl/swipl-bundle-no-data';
export default function (image: string | Buffer | Uint8Array): (options?: Partial<EmscriptenModule> | undefined) => Promise<SWIPL.SWIPLModule>;
