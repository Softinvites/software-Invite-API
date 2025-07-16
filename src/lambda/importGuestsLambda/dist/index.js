import { v4 as uuidv4 } from "uuid";
import { parseCsvExcel } from "./parseCsvExcel.js";
import { handler as generateQrToS3 } from "./generateQrToS3.js";
import { rgbToHex } from "./colorUtils.js";
export const handler = async (event) => {
    const { fileUrl, eventId } = event;
    if (!fileUrl || !eventId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Missing fileUrl or eventId" }),
        };
    }
    try {
        console.log("Fetching guests from file URL:", fileUrl);
        const guests = await parseCsvExcel(fileUrl);
        if (!Array.isArray(guests) || guests.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No valid guests found in file.",
                    guests: [],
                    successful: 0,
                }),
            };
        }
        const validGuests = guests.filter((g) => g.fullname &&
            g.fullname.trim() !== "" &&
            g.qrCodeBgColor &&
            g.qrCodeCenterColor &&
            g.qrCodeEdgeColor);
        if (validGuests.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No valid guests found in file after filtering.",
                    guests: [],
                    successful: 0,
                }),
            };
        }
        const results = [];
        const batchSize = 10;
        for (let i = 0; i < validGuests.length; i += batchSize) {
            const batch = validGuests.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch.map(async (guest, index) => {
                try {
                    if (!guest.fullname ||
                        !guest.qrCodeBgColor ||
                        !guest.qrCodeCenterColor ||
                        !guest.qrCodeEdgeColor) {
                        throw new Error("Missing required guest fields");
                    }
                    const guestId = uuidv4();
                    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
                    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
                    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);
                    const qrResponse = await generateQrToS3({
                        guestId,
                        fullname: guest.fullname,
                        qrCodeBgColor: bgColorHex,
                        qrCodeCenterColor: centerColorHex,
                        qrCodeEdgeColor: edgeColorHex,
                        eventId,
                    });
                    const qrData = JSON.parse(qrResponse.body);
                    return {
                        fullname: guest.fullname,
                        TableNo: guest.TableNo ?? "",
                        email: guest.email ?? "",
                        phone: guest.phone ?? "",
                        message: guest.message ?? "You are invited!",
                        others: guest.others ?? "",
                        qrCodeUrl: qrData.qrCodeUrl,
                        qrCodeData: guestId,
                        qrCodeBgColor: guest.qrCodeBgColor,
                        qrCodeCenterColor: guest.qrCodeCenterColor,
                        qrCodeEdgeColor: guest.qrCodeEdgeColor,
                        success: true,
                    };
                }
                catch (error) {
                    console.error(`Failed to process guest at index ${i + index}:`, error);
                    return {
                        fullname: guest.fullname ?? "Unknown",
                        error: error instanceof Error ? error.message : "Unknown error",
                        success: false,
                    };
                }
            }));
            results.push(...batchResults);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                guests: results,
                totalProcessed: guests.length,
                successful: results.filter((r) => r.status === "fulfilled").length,
                failed: results.filter((r) => r.status === "rejected").length,
            }),
        };
    }
    catch (error) {
        console.error("Error importing guests:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error importing guests",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
};
