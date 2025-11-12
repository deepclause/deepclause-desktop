"use strict";
/// <reference types="emscripten" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadImage = loadImage;
function loadImage(image, swipl) {
    return (options) => swipl(Object.assign(Object.assign({}, options), { arguments: ['-q', '-x', 'image.pvm'], 
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        preRun: [(module) => module.FS.writeFile('image.pvm', image)] }));
}
