import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { WhatsAppMessage } from "./whatsappmessagemodel.js";
import { invokeLambda } from "./lambdaUtils.js";
import axios from "axios";

const { ADMIN_EMAIL, EMAIL_LAMBDA_FUNCTION_NAME } = process.env;
let cachedPhoneNumberId: string | null =
  process.env.WHATSAPP_PHONE_NUMBER_ID || null;

interface WhatsAppResult {
  total: number;
  sent: number;
  failed: number;
  details: Array<{
    guestId: string;
    name: string;
    messageId?: string;
    error?: string;
    status: string;
  }>;
}

export const handler = async (event: any) => {
  try {
    console.log("📱 WhatsApp Bulk Send Started");

    const { eventId, templateName = "event_invitation", guestIds } = event;
    if (!eventId) {
      return { statusCode: 400, body: "Missing eventId" };
    }

    await connectDB();

    const eventDoc = await Event.findById(eventId);
    if (!eventDoc) {
      return { statusCode: 404, body: "Event not found" };
    }

    let guestQuery: any = { eventId, phone: { $exists: true, $ne: "" } };
    if (guestIds && guestIds.length > 0) {
      guestQuery._id = { $in: guestIds };
    }

    const guests = await Guest.find(guestQuery);
    if (!guests.length) {
      return { statusCode: 404, body: "No guests with phone numbers found" };
    }

    console.log(`📱 Found ${guests.length} guests with phone numbers`);

    // Resolve phone number ID once up front to avoid per-message failures
    let phoneNumberId: string;
    try {
      phoneNumberId = await resolvePhoneNumberId();
    } catch (resolveErr: any) {
      console.error(
        "Failed to resolve WhatsApp phone number id before sending:",
        resolveErr.response?.data || resolveErr.message || resolveErr,
      );
      return {
        statusCode: 500,
        body: JSON.stringify({
          message:
            "Unable to resolve WhatsApp phone number ID; check access token, business account ID, and phone number setup.",
          error:
            resolveErr.response?.data ||
            resolveErr.message ||
            String(resolveErr),
        }),
      };
    }

    const results: WhatsAppResult = {
      total: guests.length,
      sent: 0,
      failed: 0,
      details: [],
    };

    const failed: any[] = [];

    // WhatsApp rate limits: Tier 1=50/sec, Tier 2=100/sec, Tier 3=200/sec
    // Conservative batch size for Tier 1 (most common)
    const BATCH_SIZE = 10; // 10 messages per batch
    const DELAY_MS = 250; // 250ms delay = ~40 msg/sec (safe for Tier 1)
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (guest) => {
          try {
            if (!guest.phone) {
              results.failed++;
              const failedGuest = {
                fullname: guest.fullname,
                phone: guest.phone,
                error: "No phone number",
              };
              failed.push(failedGuest);
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                error: "No phone number",
                status: "failed",
              });
              return;
            }

            const qrCodeUrl = guest.qrCode?.includes(".png")
              ? guest.qrCode
              : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`;

            const templateParams = [
              guest.fullname,
              eventDoc.name,
              eventDoc.location || "TBA",
              eventDoc.date || "TBA",
              qrCodeUrl,
            ];

            const result = await sendWhatsAppMessage(
              guest.phone,
              templateName,
              templateParams,
              guest._id.toString(),
              (eventDoc._id as any).toString(),
              phoneNumberId,
            );

            if (result.success) {
              results.sent++;
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                messageId: result.messageId,
                status: "sent",
              });
            } else {
              results.failed++;
              const failedGuest = {
                fullname: guest.fullname,
                phone: guest.phone,
                error: result.error || "Unknown error",
              };
              failed.push(failedGuest);
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                error: result.error,
                status: "failed",
              });
            }

            // WhatsApp rate limiting - optimized for Tier 1 (50 msg/sec)
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
          } catch (error: any) {
            results.failed++;
            const failedGuest = {
              fullname: guest.fullname,
              phone: guest.phone,
              error: error.message || String(error),
            };
            failed.push(failedGuest);
            results.details.push({
              guestId: guest._id.toString(),
              name: guest.fullname,
              error: error.message,
              status: "failed",
            });
          }
        }),
      );

      console.log(`WhatsApp batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    // Send admin notification
    try {
      await invokeLambda(EMAIL_LAMBDA_FUNCTION_NAME!, {
        to: ADMIN_EMAIL,
        from: `SoftInvites <info@softinvite.com>`,
        subject: `WhatsApp Send Complete - ${eventDoc.name}`,
        htmlContent: buildAdminEmailTemplate(eventDoc, results, failed),
      });
    } catch (adminEmailError) {
      console.error("Failed to send admin notification:", adminEmailError);
    }

    console.log("✅ WhatsApp Bulk Send Completed");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "WhatsApp bulk send completed",
        totalGuests: results.total,
        successCount: results.sent,
        failureCount: results.failed,
      }),
    };
  } catch (err: any) {
    console.error("❌ WhatsApp Bulk Send Failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "WhatsApp bulk send failed",
        error: err.message,
      }),
    };
  }
};

async function resolvePhoneNumberId(): Promise<string> {
  if (cachedPhoneNumberId) {
    return cachedPhoneNumberId;
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!accessToken) {
    throw new Error(
      "Missing WHATSAPP_ACCESS_TOKEN for WhatsApp Cloud API calls",
    );
  }

  if (!businessAccountId) {
    throw new Error(
      "Missing WHATSAPP_BUSINESS_ACCOUNT_ID to resolve phone number ID",
    );
  }

  const url = `https://graph.facebook.com/v18.0/${businessAccountId}/phone_numbers`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      fields: "id,verified_name,display_phone_number,name_status",
    },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    console.error(
      "Failed to list WhatsApp phone numbers from business account",
      {
        status: response.status,
        data: response.data,
      },
    );
    throw new Error(
      `Failed to list WhatsApp phone numbers (status ${response.status})`,
    );
  }

  const phoneNumberId = response.data?.data?.[0]?.id;
  if (!phoneNumberId) {
    throw new Error(
      "Unable to resolve WhatsApp phone number ID from business account",
    );
  }

  cachedPhoneNumberId = phoneNumberId;
  console.log(`ℹ️ Resolved WhatsApp phone number id ${phoneNumberId}`);
  return phoneNumberId;
}

async function sendWhatsAppMessage(
  phoneNumber: string,
  templateName: string,
  templateParams: string[],
  guestId: string,
  eventId: string,
  phoneNumberId?: string,
  allowRetry: boolean = true,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const resolvedPhoneNumberId =
      phoneNumberId || (await resolvePhoneNumberId());
    const payload = {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: templateParams.map((param) => ({
              type: "text",
              text: param,
            })),
          },
        ],
      },
    };

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${resolvedPhoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    const messageRecord = new WhatsAppMessage({
      guestId,
      eventId,
      templateName,
      providerMessageId: response.data.messages[0].id,
      phoneNumber,
      status: "sent",
    });

    await messageRecord.save();

    return {
      success: true,
      messageId: response.data.messages[0].id,
    };
  } catch (error: any) {
    const graphError = error.response?.data?.error;
    const errorMessage = graphError?.message || error.message;

    // If the configured phone number id is wrong or not accessible, try to resolve a valid one once
    if (
      allowRetry &&
      graphError?.code === 100 &&
      graphError?.error_subcode === 33
    ) {
      console.warn(
        "WhatsApp phone number id rejected; attempting to resolve a valid id from the business account",
      );
      cachedPhoneNumberId = null;
      try {
        const newPhoneId = await resolvePhoneNumberId();
        return await sendWhatsAppMessage(
          phoneNumber,
          templateName,
          templateParams,
          guestId,
          eventId,
          newPhoneId,
          false,
        );
      } catch (resolveError: any) {
        console.error(
          "Failed to resolve WhatsApp phone number id after Graph error:",
          resolveError.message || resolveError,
        );
      }
    }

    console.error(
      "WhatsApp send error:",
      error.response?.data || error.message,
    );

    const messageRecord = new WhatsAppMessage({
      guestId,
      eventId,
      templateName,
      providerMessageId: `failed_${Date.now()}`,
      phoneNumber,
      status: "failed",
      errorMessage: errorMessage,
    });

    await messageRecord.save();

    return {
      success: false,
      error: errorMessage,
    };
  }
}

function buildAdminEmailTemplate(
  eventDoc: any,
  results: WhatsAppResult,
  failed: any[],
): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f7f8fc;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <h2 style="color: #2d3748; border-bottom: 3px solid #25D366; padding-bottom: 10px;">
          📱 WhatsApp Send Completed Successfully
        </h2>
        
        <div style="background: #f8faff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #4a5568; margin-top: 0;">Event Details</h3>
          <p><strong>Event Name:</strong> ${eventDoc.name}</p>
          <p><strong>Event Date:</strong> ${eventDoc.date}</p>
          <p><strong>Processed At:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
          <div style="background: #25D366; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Total Guests</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.total}</p>
          </div>
          
          <div style="background: #4299e1; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Sent Successfully</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.sent}</p>
          </div>
          
          <div style="background: #e53e3e; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Failed</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.failed}</p>
          </div>
          
          <div style="background: #805ad5; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Success Rate</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${Math.round((results.sent / results.total) * 100)}%</p>
          </div>
        </div>
        
        ${
          results.failed > 0
            ? `
          <div style="margin-bottom: 20px;">
            <h3 style="color: #e53e3e; margin-bottom: 15px;">❌ Failed Messages (${results.failed})</h3>
            <div style="max-height: 300px; overflow-y: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead style="background: #f7f8fc; position: sticky; top: 0;">
                  <tr>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Full Name</th>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Phone</th>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Error</th>
                  </tr>
                </thead>
                <tbody>
                  ${failed
                    .slice(0, 50)
                    .map(
                      (guest) => `
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.fullname || "N/A"}</td>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.phone || "N/A"}</td>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #e53e3e;">${guest.error || "Unknown error"}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                  ${
                    failed.length > 50
                      ? `
                    <tr>
                      <td colspan="3" style="padding: 8px; text-align: center; color: #718096;">
                        ... and ${failed.length - 50} more failed records
                      </td>
                    </tr>
                  `
                      : ""
                  }
                </tbody>
              </table>
            </div>
          </div>
        `
            : ""
        }
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #718096; font-size: 12px;">
          <p>WhatsApp send completed by Soft Invites System</p>
        </div>
      </div>
    </div>
  `;
}
