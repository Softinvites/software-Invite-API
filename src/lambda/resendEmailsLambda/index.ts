import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { invokeLambda } from "./lambdaUtils.js";
import { buildInvitationEmail } from "./buildInvitationEmail.js";

const { EMAIL_LAMBDA_FUNCTION_NAME, ADMIN_EMAIL } = process.env;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function safeInvoke(
  functionName: string,
  payload: any,
  asyncInvoke = false,
  retries = 6,
) {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await invokeLambda(functionName, payload, asyncInvoke);
    } catch (err: any) {
      const attempt = i + 1;
      console.error(
        `Invoke failed (${attempt}/${retries}) → ${functionName}`,
        err?.message || err,
      );

      if (attempt >= retries) {
        throw err;
      }

      const baseDelay = Math.min(30000, Math.pow(2, attempt) * 1000);
      const jitter = Math.floor(Math.random() * 300);
      await sleep(baseDelay + jitter);
    }
  }
}

export const handler = async (event: any) => {
  try {
    console.log("✅ Resend Emails Started");

    const { eventId } = event;
    if (!eventId) {
      return { statusCode: 400, body: "Missing eventId" };
    }

    await connectDB();

    const eventDoc = await Event.findById(eventId);
    if (!eventDoc) {
      return { statusCode: 404, body: "Event not found" };
    }

    const guests = await Guest.find({
      eventId,
      email: { $exists: true, $ne: "" },
    });
    if (!guests.length) {
      return { statusCode: 404, body: "No guests with email found" };
    }

    console.log(`Found ${guests.length} guests with emails`);

    const attachments =
      eventDoc.iv && eventDoc.iv.includes(".s3.")
        ? [
            {
              filename: `${eventDoc.name.replace(/[^a-zA-Z0-9]/g, "_")}_invitation.jpg`,
              s3Key: decodeURIComponent(new URL(eventDoc.iv).pathname.slice(1)),
              contentType: "image/jpeg",
            },
          ]
        : [];

    let successCount = 0;
    let failureCount = 0;
    const failed: any[] = [];

    // Queue email jobs in manageable async batches so SES throttling is handled
    // in the email lambda without spiking request/response invokes here.
    const BATCH_SIZE = 10;
    const INTER_BATCH_DELAY_MS = 1200;
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (guest) => {
          try {
            // Use pre-generated PNG URL if available; fall back to SVG URL
            const pngUrl = (guest as any)?.pngUrl || "";

            const finalQrUrl = pngUrl || guest.qrCode;

            // Send email using same template as addGuest/updateGuest
            console.log(`Sending email to ${guest.email}`);
            await safeInvoke(
              EMAIL_LAMBDA_FUNCTION_NAME!,
              {
                to: guest.email,
                from: `SoftInvites <info@softinvite.com>`,
                subject: `${eventDoc.name}`,
                htmlContent: buildInvitationEmail({
                  fullname: guest.fullname,
                  message: guest.message || "You're invited!",
                  eventName: eventDoc.name,
                  eventDate: eventDoc.date || "",
                  qrCodeCenterColor: guest.qrCodeCenterColor,
                  finalQrUrl: finalQrUrl,
                }),
                attachments: attachments.length > 0 ? attachments : undefined,
                eventId,
                messageType: "guest-resend-invitation",
                diagnosticContext: {
                  source: "resendEmailsLambda",
                  guestId: guest._id.toString(),
                  trigger: "manual-resend",
                },
              },
              true,
            );
            console.log(`Email sent to ${guest.email}`);

            successCount++;
            return { success: true, guest: guest.fullname };
          } catch (error: any) {
            failureCount++;
            const failedGuest = {
              fullname: guest.fullname,
              email: guest.email,
              error: (error as any)?.message || String(error),
            };
            failed.push(failedGuest);
            console.error(`Failed to send email to ${guest.fullname}:`, error);
            return { success: false, guest: guest.fullname, error };
          }
        })
      );

      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
      if (i + BATCH_SIZE < guests.length) {
        await sleep(INTER_BATCH_DELAY_MS);
      }
    }

    // Send success notification to admin
    try {
      await safeInvoke(
        EMAIL_LAMBDA_FUNCTION_NAME!,
        {
          to: ADMIN_EMAIL,
          from: `SoftInvites <info@softinvite.com>`,
          subject: `Email Resend Complete - ${eventDoc.name}`,
          htmlContent: `

        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f7f8fc;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <h2 style="color: #2d3748; border-bottom: 3px solid #4a5568; padding-bottom: 10px;">Email Resend Completed Successfully</h2>
            
            <div style="background: #f8faff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #4a5568; margin-top: 0;">Event Details</h3>
              <p><strong>Event Name:</strong> ${eventDoc.name}</p>
              <p><strong>Event Date:</strong> ${eventDoc.date}</p>
              <p><strong>Processed At:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
              <div style="background: #48bb78; color: white; padding: 15px; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0 0 10px 0; font-size: 14px;">Total Guests</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 0;">${
                  guests.length
                }</p>
              </div>
              
              <div style="background: #4299e1; color: white; padding: 15px; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0 0 10px 0; font-size: 14px;">Successful</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 0;">${successCount}</p>
              </div>
              
              <div style="background: #e53e3e; color: white; padding: 15px; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0 0 10px 0; font-size: 14px;">Failed</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 0;">${failureCount}</p>
              </div>  
            </div>

             ${
               failureCount > 0
                 ? `
              <div style="margin-bottom: 20px;">
                <h3 style="color: #e53e3e; margin-bottom: 15px;">❌ Failed Guests (${failureCount})</h3>
                <div style="max-height: 300px; overflow-y: auto;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead style="background: #f7f8fc; position: sticky; top: 0;">
                      <tr>
                        <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Full Name</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Email</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${failed
                        .slice(0, 50)
                        .map(
                          (guest) => `
                        <tr>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${
                            guest.fullname || "N/A"
                          }</td>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${
                            guest.email || "N/A"
                          }</td>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #e53e3e;">${
                            guest.error || "Unknown error"
                          }</td>
                        </tr>
                      `
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
              <p>Email resend completed by Soft Invites System</p>
            </div>
          </div>
        </div>
        `,
          eventId,
          messageType: "guest-resend-admin-summary",
          diagnosticContext: {
            source: "resendEmailsLambda",
            trigger: "resend-summary",
          },
        },
        true,
      );
    } catch (adminEmailError) {
      console.error("Failed to send admin notification:", adminEmailError);
    }

    console.log("✅ Resend Emails Completed");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Email resend completed",
        totalGuests: guests.length,
        successCount,
        failureCount,
      }),
    };
  } catch (err: any) {
    console.error("❌ Resend Emails Failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Email resend failed",
        error: err.message,
      }),
    };
  }
};
