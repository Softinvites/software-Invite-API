import { connectDB } from "./db.js";
import { processPendingSchedules } from "./jobs/messageScheduler.js";
const parseLimit = (input, fallback = 50) => {
    const value = Number(input);
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(1, Math.min(500, Math.trunc(value)));
};
const parseEventBody = (event) => {
    if (!event)
        return {};
    if (typeof event.body === "string") {
        try {
            return JSON.parse(event.body);
        }
        catch {
            return {};
        }
    }
    if (event.body && typeof event.body === "object") {
        return event.body;
    }
    return event;
};
const resolveSecret = (event, body) => {
    const headerSecret = event?.headers?.["x-scheduler-secret"] || event?.headers?.["X-Scheduler-Secret"];
    if (typeof headerSecret === "string" && headerSecret.trim()) {
        return headerSecret.trim();
    }
    if (typeof body?.secret === "string" && body.secret.trim()) {
        return body.secret.trim();
    }
    return "";
};
export const handler = async (event) => {
    try {
        const body = parseEventBody(event);
        const requiredSecret = process.env.RSVP_SCHEDULER_SECRET;
        const fromEventBridge = event?.source === "aws.events";
        const providedSecret = resolveSecret(event, body);
        if (requiredSecret && !fromEventBridge && providedSecret !== requiredSecret) {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: "Invalid scheduler secret" }),
            };
        }
        await connectDB();
        const limit = parseLimit(body?.limit, 50);
        const startedAt = Date.now();
        const summary = await processPendingSchedules({ limit });
        const durationMs = Date.now() - startedAt;
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "RSVP scheduler batch completed",
                limit,
                durationMs,
                ...summary,
            }),
        };
    }
    catch (error) {
        console.error("rsvpSchedulerLambda error", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Failed to run RSVP scheduler batch",
                error: error?.message || "Unknown error",
            }),
        };
    }
};
