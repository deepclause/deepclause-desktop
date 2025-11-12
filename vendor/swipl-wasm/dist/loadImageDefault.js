"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const swipl_bundle_no_data_1 = __importDefault(require("./swipl/swipl-bundle-no-data"));
const loadImage_1 = require("./loadImage");
function default_1(image) {
    return (0, loadImage_1.loadImage)(image, swipl_bundle_no_data_1.default);
}
