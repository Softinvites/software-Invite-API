import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { invokeLambda } from "./lambdaUtils.js";
import { buildInvitationEmail } from "./buildInvitationEmail.js";

const { EMAIL_LAMBDA_FUNCTION_NAME, ADMIN_EMAIL } = process.env;

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

    const guests = await Guest.find({ eventId, email: { $exists: true, $ne: "" } });
    if (!guests.length) {
      return { statusCode: 404, body: "No guests with email found" };
    }

    console.log(`📧 Found ${guests.length} guests with emails`);

    let successCount = 0;
    let failureCount = 0;
    const failed: any[] = [];

    // Process guests in batches (respecting SES rate limit of 14/sec)
    const BATCH_SIZE = 5;
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(async (guest) => {
          try {
            // Convert SVG to PNG for email
            let pngUrl = "";
            if (guest.qrCode) {
              try {
                const pngResult: any = await invokeLambda(process.env.PNG_CONVERT_LAMBDA!, {
                  guestId: guest._id.toString(),
                  eventId: eventId
                });
                pngUrl = pngResult?.pngUrl || "";
              } catch (pngError) {
                console.error(`PNG conversion failed for ${guest.fullname}:`, pngError);
              }
            }

            const finalQrUrl = pngUrl || guest.qrCode;
            const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id.toString()}`;

            // Prepare attachments array for IV (using S3 keys like import Lambda)
            const attachments = [];
            if (eventDoc.iv) {
              try {
                // Check if it's an S3 URL and extract S3 key
                if (eventDoc.iv.includes('.s3.')) {
                  const url = new URL(eventDoc.iv);
                  const s3Key = decodeURIComponent(url.pathname.slice(1));
                  
                  attachments.push({
                    filename: `${eventDoc.name.replace(/[^a-zA-Z0-9]/g, '_')}_invitation.jpg`,
                    s3Key: s3Key,
                    contentType: 'image/jpeg'
                  });
                  console.log(`📎 Using S3 key for attachment: ${s3Key}`);
                } else {
                  console.warn('⚠️ IV URL is not an S3 URL, skipping attachment');
                }
              } catch (attachmentError) {
                console.error(`Failed to prepare IV attachment for ${guest.fullname}:`, attachmentError);
              }
            }

            // Send email using same template as addGuest/updateGuest
            console.log(`📧 Sending email to ${guest.email}`);
            await invokeLambda(EMAIL_LAMBDA_FUNCTION_NAME!, {
              to: guest.email,
              from: `SoftInvites <info@softinvite.com>`,
              subject: `You're Invited to ${eventDoc.name}`,
              htmlContent: buildInvitationEmail({
                fullname: guest.fullname,
                message: guest.message || "You're invited!",
                eventName: eventDoc.name,
                eventDate: eventDoc.date || "",
                qrCodeCenterColor: guest.qrCodeCenterColor,
                finalQrUrl: finalQrUrl,
                downloadUrl: downloadUrl,
              }),
              attachments: attachments.length > 0 ? attachments : undefined
            });
            console.log(`✅ Email sent to ${guest.email}`);
            
            // Add delay to respect SES rate limit (5 emails per batch = ~10/sec)
            await new Promise(resolve => setTimeout(resolve, 500));

            successCount++;
            return { success: true, guest: guest.fullname };
          } catch (error: any) {
            failureCount++;
            const failedGuest = {
              fullname: guest.fullname,
              email: guest.email,
              error: error.message || String(error)
            };
            failed.push(failedGuest);
            console.error(`Failed to send email to ${guest.fullname}:`, error);
            return { success: false, guest: guest.fullname, error };
          }
        })
      );

      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    // Send success notification to admin
    try {
      await invokeLambda(EMAIL_LAMBDA_FUNCTION_NAME!, {
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
                <p style="font-size: 32px; font-weight: bold; margin: 0;">${guests.length}</p>
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

             ${failureCount > 0 ? `
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
                      ${failed.slice(0, 50).map(guest => `
                        <tr>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.fullname || 'N/A'}</td>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.email || 'N/A'}</td>
                          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #e53e3e;">${guest.error || 'Unknown error'}</td>
                        </tr>
                      `).join('')}
                      ${failed.length > 50 ? `
                        <tr>
                          <td colspan="3" style="padding: 8px; text-align: center; color: #718096;">
                            ... and ${failed.length - 50} more failed records
                          </td>
                        </tr>
                      ` : ''}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #718096; font-size: 12px;">
              <p>Email resend completed by Soft Invites System</p>
            </div>
          </div>
        </div>
        `
      });
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