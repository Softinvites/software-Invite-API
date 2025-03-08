import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// ✅ Zoho Mail Transporter
const zohoTransporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_USER,
    pass: process.env.ZOHO_PASS,
  },
});

// ✅ Brevo Mail Transporter
const brevoTransporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.ZOHO_USER, // Use Zoho email for Brevo SMTP authentication
    pass: process.env.BREVO_API_KEY,
  },
});

// ✅ Function to send email
export const sendEmail = async (
  recipient: string,
  subject: string,
  htmlContent: string,
  useBrevo: boolean = false
) => {
  try {
    const transporter = useBrevo ? brevoTransporter : zohoTransporter;

    const mailOptions = {
      from: `"Event Organizer" <${process.env.ZOHO_USER}>`,
      to: recipient,
      subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: ", info.messageId);
  } catch (error) {
    console.error("Error sending email: ", error);
  }
};
