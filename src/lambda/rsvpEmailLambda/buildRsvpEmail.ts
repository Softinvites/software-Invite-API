type RsvpEmailParams = {
  eventName: string;
  eventDate?: string;
  eventDescription?: string;
  rsvpMessage?: string;
  guestName: string;
  yesUrl: string;
  noUrl: string;
  headerBg?: string;
  accent?: string;
};

// Branded footer: tells guests to look out for SoftInvites messages.
const softInvitesFooterHtml = () => `
        <div style="background:#f7f8fc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="font-size:12px;color:#718096;margin:0 0 6px 0;">Sent by <strong style="color:#4a5568;">SoftInvites</strong> on behalf of your host. Look out for messages from SoftInvites for updates about this event.</p>
          <p style="font-size:12px;color:#718096;margin:0;">&copy; ${new Date().getFullYear()} <strong style="color:#4a5568;">SoftInvites</strong> &bull; All rights reserved</p>
        </div>`;

export function buildRsvpEmail({
  eventName,
  eventDate,
  eventDescription,
  rsvpMessage,
  guestName,
  yesUrl,
  noUrl,
  headerBg,
  accent,
}: RsvpEmailParams) {
  const headerColor = headerBg || "#111827";
  const accentColor = accent || "#111827";

  return `
    <div style="font-family:'Segoe UI','Arial',sans-serif;background:#f7f8fc;padding:24px 10px;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08);">
        <div style="background:${headerColor};padding:24px 20px;text-align:center;color:#fff;">
          <h1 style="margin:0 0 6px 0;font-size:22px;">${eventName}</h1>
          <p style="margin:0;font-size:14px;">${eventDate || ""}</p>
        </div>
        <div style="padding:24px 20px;">
          <p style="font-size:15px;margin:0 0 16px 0;">Dear ${guestName},</p>
          <div style="font-size:14px;color:#4a5568;line-height:1.7;margin:0 0 20px 0;">
            ${rsvpMessage || eventDescription || "You're invited! Please let us know if you will attend."}
          </div>
          <p style="font-size:14px;margin:0 0 12px 0;">Will you attend?</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${yesUrl}" style="display:inline-block;background:${headerColor};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Yes</a>
            <a href="${noUrl}" style="display:inline-block;background:${accentColor};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">No</a>
          </div>
          <p style="font-size:12px;color:#94a3b8;margin-top:16px;">
            If the buttons do not work, you can copy these links into your browser:
          </p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">Yes: ${yesUrl}</p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">No: ${noUrl}</p>
        </div>
        ${softInvitesFooterHtml()}
      </div>
    </div>
  `;
}
