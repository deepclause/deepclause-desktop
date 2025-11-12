export declare function generateImageBuffer(prolog: string | Buffer): Promise<Uint8Array>;
export declare function generateImageString(prolog: string | Buffer): Promise<string>;
export declare function generateImageFileString(prolog: string | Buffer): Promise<string>;
export declare function generateLoadedImageFileString(prolog: string | Buffer): Promise<string>;
export declare function generateImageFile(prologPath: string, jsPath: string): Promise<void>;
export declare function generateLoadedImageFile(prologPath: string, jsPath: string): Promise<void>;
