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
    color: edgeColor || "#000000",
    background: bgColor || "#FFFFFF",
    xmlDeclaration: false,
  });

  let svg = qr.svg();

  // Clean up formatting and ensure xmlns is defined
  svg = svg
    .replace(/[\r\n]+/g, " ")
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<svg/, `<svg xmlns="http://www.w3.org/2000/svg"`);

  // Inject gradient
  const gradient = `
    <defs>
      <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${centerColor || edgeColor}" stop-opacity="1" />
        <stop offset="100%" stop-color="${edgeColor || "#000"}" stop-opacity="1" />
      </radialGradient>
    </defs>
  `;

  svg = svg.replace(/(<svg[^>]*>)/, `$1${gradient}`);

  // Replace background and QR paths with gradient fill
  svg = svg.replace(
    /<rect([^>]*?)fill="[^"]*"/,
    `<rect$1fill="${bgColor || "#FFFFFF"}"`
  );

  svg = svg.replace(
    /<path([^>]*?)fill="[^"]*"/g,
    `<path$1fill="url(#grad1)"`
  );

  // Close tag if missing
  if (!svg.endsWith("</svg>")) svg += "</svg>";

  return svg;
};
