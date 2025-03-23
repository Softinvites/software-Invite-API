"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgbToHex = void 0;
const rgbToHex = (rgb) => {
    const [r, g, b] = rgb.split(",").map((num) => parseInt(num.trim(), 10));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};
exports.rgbToHex = rgbToHex;
