"use strict";
// export const rgbToHex = (rgb: string): string => {
//     const [r, g, b] = rgb.split(",").map((num) => parseInt(num.trim(), 10));
//     return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
//   };
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgbToHex = void 0;
const rgbToHex = (rgb) => {
    var _a;
    const result = (_a = rgb
        .match(/\d+/g)) === null || _a === void 0 ? void 0 : _a.map((x) => parseInt(x).toString(16).padStart(2, "0")).join("");
    return result ? `#${result}` : "#000000";
};
exports.rgbToHex = rgbToHex;
