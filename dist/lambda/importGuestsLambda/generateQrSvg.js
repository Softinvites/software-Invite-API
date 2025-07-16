"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateQrSvg = void 0;
const qrcode_svg_1 = __importDefault(require("qrcode-svg"));
const generateQrSvg = (guestId, bgColor, centerColor, edgeColor) => {
    const qr = new qrcode_svg_1.default({
        content: guestId,
        padding: 10,
        width: 512,
        height: 512,
        color: edgeColor,
        background: bgColor,
        xmlDeclaration: false,
    });
    let svg = qr.svg();
    svg = svg.replace(/(<svg[^>]*>)/, `$1<defs>
      <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stop-color="${centerColor}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${edgeColor}" stop-opacity="1"/>
      </radialGradient>
    </defs>`);
    svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
            ? `<rect${group1}style="fill:${bgColor};${group2}"/>`
            : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
    });
    return svg;
};
exports.generateQrSvg = generateQrSvg;
