// Display name on guest-facing emails. Each event picks SoftInvites (the
// default), its own title, or custom text. The address never changes, so SES
// verification and replies are unaffected.
export const EMAIL_SENDER_ADDRESS = "info@softinvite.com";

const cleanSenderName = (value: unknown) =>
  String(value ?? "")
    .replace(/[<>"\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

export const resolveEmailSenderName = (event: any): string => {
  const mode = event?.emailSenderMode;
  const name =
    mode === "event"
      ? cleanSenderName(event?.name)
      : mode === "custom"
        ? cleanSenderName(event?.emailSenderName)
        : "";
  return name || "SoftInvites";
};

export const buildEventEmailFrom = (event: any): string =>
  `${resolveEmailSenderName(event)} <${EMAIL_SENDER_ADDRESS}>`;
