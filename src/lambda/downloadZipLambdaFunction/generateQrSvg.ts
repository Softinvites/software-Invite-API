import QRCode from "qrcode-svg";

/**
 * generateQrSvg
 * Produces a QR SVG string with an injected radial gradient and background rect.
 *
 * @param guestId - string encoded inside the QR
 * @param bgColor - background color (hex or color string)
 * @param centerColor - center gradient color
 * @param edgeColor - edge gradient color
 * @returns SVG string
 */
export const generateQrSvg = (
  guestId: string,
  bgColor: string,
  centerColor: string,
  edgeColor: string
): string => {
  const qr = new QRCode({
    content: String(guestId),
    padding: 10,
    width: 512,
    height: 512,
    color: edgeColor || "#000000",
    background: bgColor || "#ffffff",
    xmlDeclaration: false,
  });

  let svg = qr.svg();

  // Ensure we have a safe set of colors (fallback)
  const safeBg = bgColor || "#ffffff";
  const safeCenter = centerColor || safeBg;
  const safeEdge = edgeColor || safeCenter;

  // Inject or extend <defs> with radial gradient id="grad1"
  if (/<defs[^>]*>/.test(svg)) {
    svg = svg.replace(
      /<defs([^>]*)>/,
      `<defs$1>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${safeCenter}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${safeEdge}" stop-opacity="1"/>
        </radialGradient>`
    );
  } else {
    svg = svg.replace(
      /(<svg[^>]*>)/,
      `$1<defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${safeCenter}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${safeEdge}" stop-opacity="1"/>
        </radialGradient>
      </defs>`
    );
  }

  // Ensure background rect uses bgColor (or add one)
  if (/<rect[^>]*>/i.test(svg)) {
    svg = svg.replace(/<rect([^>]*)>/i, (match, attrs) => {
      if (/fill=/.test(attrs)) {
        return `<rect${attrs.replace(/fill="[^"]*"/i, `fill="${safeBg}"`)}>`;
      }
      return `<rect${attrs} fill="${safeBg}">`;
    });
  } else {
    svg = svg.replace(/(<svg[^>]*>)/i, `$1<rect width="100%" height="100%" fill="${safeBg}" />`);
  }

  // Replace QR module path fills with gradient reference (best-effort)
  svg = svg.replace(/(<path[^>]*?)fill="[^"]*"/g, `$1fill="url(#grad1)"`);

  return svg;
};
export default generateQrSvg;
