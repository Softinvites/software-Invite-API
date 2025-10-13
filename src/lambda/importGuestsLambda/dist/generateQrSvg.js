// import QRCode from 'qrcode-svg';
// export const generateQrSvg = (
//   guestId: string,
//   bgColor: string,
//   centerColor: string,
//   edgeColor: string
// ): string => {
//   const qr = new QRCode({
//     content: guestId,
//     padding: 10,
//     width: 512,
//     height: 512,
//     color: edgeColor,
//     background: bgColor,
//     xmlDeclaration: false,
//   });
//   let svg = qr.svg();
//   svg = svg.replace(
//     /(<svg[^>]*>)/,
//     `$1<defs>
//       <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
//         <stop offset="0%" stop-color="${centerColor}" stop-opacity="1"/>
//         <stop offset="100%" stop-color="${edgeColor}" stop-opacity="1"/>
//       </radialGradient>
//     </defs>`
//   );
//   svg = svg.replace(
//     /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
//     (match, group1, group2) => {
//       const isBoundingRect = /x="0".*y="0"/.test(group1);
//       return isBoundingRect
//         ? `<rect${group1}style="fill:${bgColor};${group2}"/>`
//         : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
//     }
//   );
//   return svg;
// };
import QRCode from "qrcode-svg";
export const generateQrSvg = (guestId, bgColor, centerColor, edgeColor) => {
    // 1️⃣ Generate base SVG
    const qr = new QRCode({
        content: guestId,
        padding: 10,
        width: 512,
        height: 512,
        color: edgeColor,
        background: bgColor,
        xmlDeclaration: false,
    });
    let svg = qr.svg();
    // 2️⃣ Insert the gradient definition inside <defs>
    svg = svg.replace(/(<svg[^>]*>)/, `$1
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${centerColor}" />
          <stop offset="100%" stop-color="${edgeColor}" />
        </radialGradient>
      </defs>
    `);
    // 3️⃣ Replace fills for QR dots (rects or paths)
    svg = svg
        // Replace any black rects with gradient fill
        .replace(/fill="(#[0-9a-fA-F]{3,6}|black)"/g, `fill="url(#grad1)"`)
        // Replace any black fills inside styles
        .replace(/style="([^"]*fill:\s*#[0-9a-fA-F]{3,6};?[^"]*)"/g, (match, style) => {
        return `style="${style.replace(/fill:\s*#[0-9a-fA-F]{3,6}/, 'fill:url(#grad1)')}"`;
    })
        // Make sure background rect stays with solid bgColor
        .replace(/<rect[^>]*x="0"[^>]*y="0"[^>]*width="100%"[^>]*height="100%"[^>]*>/, `<rect width="100%" height="100%" fill="${bgColor}" />`);
    return svg;
};
