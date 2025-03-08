import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Create a transporter using Gmail's SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_ADDRESS, // Your Gmail email address
    pass: process.env.GMAIL_PASSWORD, // Your Gmail password or App Password
  },
});

// Define email options
export const sendEmail = async (
  recipient: string,
  subject: string,
  htmlContent: string,
) => {
  try {
    const mailOptions = {
      from: `"Soft Invites" <${process.env.GMAIL_ADDRESS}>`,
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
