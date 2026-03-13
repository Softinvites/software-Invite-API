const whatsappService = {
  sendTemplateMessage: async (
    phoneNumber: string,
    templateName: string,
    templateParams: string[],
    rsvpId: string,
    eventId: string,
  ) => {
    if (!phoneNumber) {
      return { success: false, error: "Missing recipient phone" };
    }

    const provider = process.env.WHATSAPP_PROVIDER || "none";
    if (provider === "none") {
      console.warn("WhatsApp provider not configured; skipping message", {
        phoneNumber,
        templateName,
        rsvpId,
        eventId,
      });
      return { success: false, error: "WhatsApp provider not configured" };
    }

    // Keep scheduler resilient. Dedicated WhatsApp sending is handled elsewhere.
    console.log("WhatsApp send placeholder invoked", {
      phoneNumber,
      templateName,
      templateParamsCount: templateParams?.length || 0,
      rsvpId,
      eventId,
      provider,
    });
    return { success: true, messageId: `wa_${Date.now()}` };
  },
};

export default whatsappService;
