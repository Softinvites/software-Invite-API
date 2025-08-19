"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgbToHex = void 0;
const rgbToHex = (rgb) => {
    var _a;
    const result = (_a = rgb
        .match(/\d+/g)) === null || _a === void 0 ? void 0 : _a.map((x) => parseInt(x).toString(16).padStart(2, "0")).join("");
    return result ? `#${result}` : "#000000";
};
exports.rgbToHex = rgbToHex;
