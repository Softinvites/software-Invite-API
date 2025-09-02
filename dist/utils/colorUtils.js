"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgbToHex = void 0;
const rgbToHex = (rgb) => {
    const result = rgb
        .match(/\d+/g)
        ?.map((x) => parseInt(x).toString(16).padStart(2, "0"))
        .join("");
    return result ? `#${result}` : "#000000";
};
exports.rgbToHex = rgbToHex;
