"use strict";
/// <reference types="emscripten" />
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateImageBuffer = generateImageBuffer;
exports.generateImageString = generateImageString;
exports.generateImageFileString = generateImageFileString;
exports.generateLoadedImageFileString = generateLoadedImageFileString;
exports.generateImageFile = generateImageFile;
exports.generateLoadedImageFile = generateLoadedImageFile;
const swipl_bundle_1 = __importDefault(require("./swipl/swipl-bundle"));
const fs_1 = __importDefault(require("fs"));
function Uint8ToString(u8a) {
    const CHUNK_SZ = 0x8000;
    const c = [];
    for (let i = 0; i < u8a.length; i += CHUNK_SZ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        c.push(String.fromCharCode.apply(null, u8a.subarray(i, i + CHUNK_SZ)));
    }
    return c.join('');
}
function generateImageBuffer(prolog) {
    return __awaiter(this, void 0, void 0, function* () {
        const Module = yield (0, swipl_bundle_1.default)({
            arguments: ['-q', '-f', 'prolog.pl'],
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            preRun: [(module) => { module.FS.writeFile('prolog.pl', prolog); }],
        });
        Module.prolog.query("qsave_program('prolog.pvm')").once();
        return Module.FS.readFile('prolog.pvm');
    });
}
function generateImageString(prolog) {
    return __awaiter(this, void 0, void 0, function* () {
        return btoa(Uint8ToString(yield generateImageBuffer(prolog)));
    });
}
function generateImageFileString(prolog) {
    return __awaiter(this, void 0, void 0, function* () {
        return `export default "${yield generateImageString(prolog)}"\n`;
    });
}
function generateLoadedImageFileString(prolog) {
    return __awaiter(this, void 0, void 0, function* () {
        return 'import loadImage from "swipl-wasm/dist/loadImageDefault"\n' +
            'import strToBuffer from "swipl-wasm/dist/strToBuffer"\n\n' +
            `export default loadImage(strToBuffer("${yield generateImageString(prolog)}"))\n`;
    });
}
function dereference(prologPath) {
    return (prologPath.startsWith('http://') || prologPath.startsWith('https://'))
        ? fetch(prologPath).then((res) => res.text())
        : fs_1.default.readFileSync(prologPath);
}
function generateImageFile(prologPath, jsPath) {
    return __awaiter(this, void 0, void 0, function* () {
        fs_1.default.writeFileSync(jsPath, yield generateImageFileString(yield dereference(prologPath)));
    });
}
function generateLoadedImageFile(prologPath, jsPath) {
    return __awaiter(this, void 0, void 0, function* () {
        fs_1.default.writeFileSync(jsPath, yield generateLoadedImageFileString(yield dereference(prologPath)));
    });
}
