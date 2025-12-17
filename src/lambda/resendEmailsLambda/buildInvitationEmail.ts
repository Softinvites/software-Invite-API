import sanitizeHtml from "sanitize-html";
import { rgbToHex } from "./colorUtils.js";

export const buildInvitationEmail = ({
  fullname,
  message,
  eventName,
  eventDate,
  qrCodeCenterColor,
  finalQrUrl,
  downloadUrl,
}: {
  fullname: string;
  message: string;
  eventName: string;
  eventDate: string;
  qrCodeCenterColor: string;
  finalQrUrl: string;
  downloadUrl: string;
}) => {
  const sanitizedMessage = sanitizeHtml(message || "", {
    allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
    allowedAttributes: {},
  });

  const adjustColorBrightness = (hex: string, percent: number): string => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
    return (
      "#" +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
    );
  };

  const centerColorHex = rgbToHex(qrCodeCenterColor || "0,0,0");
  const darkerCenterColor = adjustColorBrightness(centerColorHex, -20);

  const num = parseInt(centerColorHex.replace("#", ""), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const textColor = brightness > 180 ? "#000000" : "#ffffff";

  return `
    <div style="font-family: 'Segoe UI', 'Arial', sans-serif; background: #f7f8fc; padding: 20px 10px; margin: 0; line-height: 1.6;">
      <div style="width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
        
        <!-- Header Section -->
        <div style="background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); padding: 40px 20px; text-align: center;">
          <h1 style="color: ${textColor}; font-size: clamp(24px, 5vw, 32px); font-weight: 600; margin: 0 0 8px 0; letter-spacing: 0.5px;">${eventName}</h1>
          <p style="color: ${textColor}; font-size: clamp(14px, 3vw, 18px); margin: 0; opacity: 0.9;">${eventDate}</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 30px 20px;">
          
          <!-- Personal Greeting -->
          <div style="margin-bottom: 30px;">
            <div style="background: #f8faff; padding: 20px; border-radius: 8px;">
              <p style="font-size: clamp(16px, 4vw, 18px); margin: 0 0 12px 0; font-weight: 600; color: ${darkerCenterColor};">Dear ${fullname},</p>
              <div style="font-size: clamp(14px, 3.5vw, 16px); color: #4a5568; line-height: 1.7;">
                ${sanitizedMessage}
              </div>
            </div>
          </div>

          <!-- QR Code Section -->
          <div style="text-align: center; background: linear-gradient(135deg, #f8faff 0%, #e8f2ff 100%); padding: 30px 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h2 style="color: ${centerColorHex}; font-size: clamp(18px, 4vw, 22px); font-weight: 600; margin: 0 0 25px 0;">Your Digital Pass</h2>
            
            <div style="background: #ffffff; padding: clamp(30px, 6vw, 50px); border-radius: 12px; display: inline-block; box-shadow: 0 4px 16px rgba(30,60,114,0.1); border: 1px solid #e2e8f0;">
              ${downloadUrl ? `
                <img src="${downloadUrl}" 
                     alt="Your Event QR Code" 
                     width="300" height="300"
                     style="display: block; border-radius: 8px; max-width: 100%; height: auto;" />
              ` : `
                <div style="width: 300px; height: 300px; background: #f7f8fc; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 2px dashed #cbd5e0; max-width: 100%;">
                  <p style="color: #718096; margin: 0; font-size: 14px; text-align: center;">Loading QR Code...</p>
                </div>
              `}
            </div>
            
            <p style="color: #718096; font-size: clamp(12px, 3vw, 14px); margin: 20px 0 25px 0;">Present this code at the event entrance for quick check-in</p>
            
            <a href="${downloadUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); color: ${textColor}; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: clamp(12px, 3vw, 14px); box-shadow: 0 4px 12px rgba(30,60,114,0.3); transition: all 0.3s ease;">
               Download QR Code
            </a>
          </div>

          <!-- Important Notice -->
          <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: #ffffff; padding: 20px; border-radius: 10px; margin: 30px 0 0 0; text-align: center;">
            <p style="font-size: 15px; font-weight: 600; margin: 0 0 5px 0;">Invitation Confirmed</p>
            <p style="font-size: 13px; margin: 0; opacity: 0.9;">This invitation is exclusively for you. Please keep your QR code secure.</p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f7f8fc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 12px; color: #718096; margin: 0;">© 2025 <strong style="color: #4a5568;">SoftInvites</strong> • All rights reserved</p>
        </div>
      </div>
    </div>
  `;
};