import QRCode from "qrcode-svg";

export const generateQrSvg = (
  guestId: string,
  bgColor: string,
  centerColor: string,
  edgeColor: string
): string => {
  const qr = new QRCode({
    content: guestId,
    padding: 10,
    width: 512,
    height: 512,
    color: edgeColor, // default path color (we'll override with gradient)
    background: bgColor,
    xmlDeclaration: false,
  });

  let svg = qr.svg();

  // Inject radial gradient definition
  svg = svg.replace(
    /(<svg[^>]*>)/,
    `$1<defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${centerColor}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${edgeColor}" stop-opacity="1"/>
        </radialGradient>
      </defs>`
  );

  // Ensure the background rect uses the bgColor
  svg = svg.replace(
    /<rect([^>]*?)fill="[^"]*"/,
    `<rect$1fill="${bgColor}"`
  );

  // Replace all path fills with gradient
  svg = svg.replace(
    /<path([^>]*?)fill="[^"]*"/g,
    `<path$1fill="url(#grad1)"`
  );

  return svg;
};
