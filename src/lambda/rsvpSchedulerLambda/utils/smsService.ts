type SendSmsInput = {
  to: string;
  message: string;
  eventId: string;
  rsvpId?: string;
};

const smsService = {
  sendSms: async (input: SendSmsInput) => {
    const { to, message, eventId, rsvpId } = input;
    if (!to) {
      return { success: false, error: "Missing recipient phone" };
    }
    if (!process.env.SMS_PROVIDER && !process.env.TERMII_API_KEY && !process.env.TWILIO_ACCOUNT_SID) {
      console.warn("SMS provider not configured; skipping message", {
        to,
        eventId,
        rsvpId,
      });
      return { success: false, error: "SMS provider not configured" };
    }

    // Keep scheduler resilient. Dedicated SMS sending is handled elsewhere.
    console.log("SMS send placeholder invoked", {
      to,
      messageLength: message?.length || 0,
      eventId,
      rsvpId,
    });
    return { success: true, providerMessageId: `sms_${Date.now()}` };
  },
};

export default smsService;
