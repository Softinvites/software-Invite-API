// import { parseCsvExcel } from "./parseCsvExcel.js";
// import { handler as generateQr } from "./generateQrToS3.js";
// import { v4 as uuidv4 } from "uuid";
// interface GuestData {
//   fullname: string;
//   TableNo?: string;
//   email?: string;
//   phone?: string;
//   message: string;
//   others: string;
//   qrCodeBgColor: string;
//   qrCodeCenterColor: string;
//   qrCodeEdgeColor: string;
// }
// interface LambdaEvent {
//   fileUrl: string;
//   eventId: string;
// }
// export const handler = async (event: LambdaEvent) => {
//   try {
//     const { fileUrl, eventId } = event;
//     if (!fileUrl || !eventId) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ message: "Missing fileUrl or eventId" }),
//       };
//     }
//     const guests = await parseCsvExcel(fileUrl);
//     const results: any[] = [];
//     // Process guests in batches to avoid timeouts
//     const batchSize = 10;
//     for (let i = 0; i < guests.length; i += batchSize) {
//       const batch = guests.slice(i, i + batchSize);
//       const batchPromises = batch.map(async (guest: GuestData) => {
//         const guestId = uuidv4();
//         try {
//           const qrResponse = await generateQr({
//             guestId,
//             fullname: guest.fullname,
//             bgColorHex: guest.qrCodeBgColor,
//             centerColorHex: guest.qrCodeCenterColor,
//             edgeColorHex: guest.qrCodeEdgeColor,
//             eventId,
//           });
//           const qrData = JSON.parse(qrResponse.body);
//           return {
//             fullname: guest.fullname,
//             qrCodeUrl: qrData.qrCodeUrl,
//             success: true,
//           };
//         } catch (error) {
//           console.error(`Failed to process guest ${guest.fullname}:`, error);
//           return {
//             fullname: guest.fullname,
//             error: error instanceof Error ? error.message : "Processing failed",
//             success: false,
//           };
//         }
//       });
//       const batchResults = await Promise.all(batchPromises);
//       results.push(...batchResults);
//     }
//     return {
//       statusCode: 201,
//       body: JSON.stringify({
//         guests: results,
//         totalProcessed: results.length,
//         successful: results.filter((r) => r.success).length,
//       }),
//     };
//   } catch (error) {
//     console.error("Error in importGuests:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         message: "Error importing guests",
//         error: error instanceof Error ? error.message : "Unknown error",
//       }),
//     };
//   }
// };
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
        const guests = await parseCsvExcel(fileUrl);
        const results = [];
        // Process in batches for reliability & avoid timeouts
        const batchSize = 10;
        for (let i = 0; i < guests.length; i += batchSize) {
            const batch = guests.slice(i, i + batchSize);
            // Limit concurrency with Promise.allSettled per batch
            const batchResults = await Promise.allSettled(batch.map(async (guest) => {
                const guestId = uuidv4();
                // Convert RGB colors to hex before passing:
                const bgColorHex = rgbToHex(guest.qrCodeBgColor);
                const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
                const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);
                try {
                    const qrResponse = await generateQrToS3({
                        guestId,
                        fullname: guest.fullname,
                        bgColorHex,
                        centerColorHex,
                        edgeColorHex,
                        eventId,
                    });
                    const qrData = JSON.parse(qrResponse.body);
                    return {
                        fullname: guest.fullname,
                        qrCodeUrl: qrData.qrCodeUrl,
                        success: true,
                    };
                }
                catch (error) {
                    console.error(`Failed to process guest ${guest.fullname}:`, error);
                    return {
                        fullname: guest.fullname,
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
