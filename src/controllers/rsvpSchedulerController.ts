import { Request, Response } from "express";
import { processPendingSchedules } from "../jobs/messageScheduler";
import { invokeLambda } from "../utils/lambdaUtils";

const parseLimit = (input: any, fallback = 50) => {
  const value = Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(value)));
};

const resolveSchedulerSecret = (req: Request) => {
  const headerSecret = req.headers["x-scheduler-secret"];
  if (typeof headerSecret === "string" && headerSecret.trim()) {
    return headerSecret.trim();
  }
  if (Array.isArray(headerSecret) && headerSecret[0]?.trim()) {
    return headerSecret[0].trim();
  }
  if (typeof (req.body as any)?.secret === "string" && (req.body as any).secret.trim()) {
    return (req.body as any).secret.trim();
  }
  return "";
};

const runSchedulerInternal = async (limit: number) => {
  const startedAt = Date.now();
  const summary = await processPendingSchedules({ limit });
  const durationMs = Date.now() - startedAt;
  return { summary, durationMs };
};

export const runSchedulerNow = async (req: Request, res: Response) => {
  try {
    const limit = parseLimit((req.body as any)?.limit ?? req.query.limit, 50);
    const { summary, durationMs } = await runSchedulerInternal(limit);
    return res.json({
      message: "RSVP scheduler batch completed",
      limit,
      durationMs,
      ...summary,
    });
  } catch (error: any) {
    console.error("runSchedulerNow error", error);
    return res.status(500).json({
      message: "Failed to run RSVP scheduler",
      error: error?.message || "Unknown error",
    });
  }
};

export const runSchedulerNowWithSecret = async (req: Request, res: Response) => {
  const requiredSecret = process.env.RSVP_SCHEDULER_SECRET;
  if (!requiredSecret) {
    return res.status(503).json({
      message: "RSVP scheduler secret is not configured",
    });
  }
  const providedSecret = resolveSchedulerSecret(req);
  if (!providedSecret || providedSecret !== requiredSecret) {
    return res.status(401).json({ message: "Invalid scheduler secret" });
  }

  try {
    const limit = parseLimit((req.body as any)?.limit ?? req.query.limit, 50);
    const { summary, durationMs } = await runSchedulerInternal(limit);
    return res.json({
      message: "RSVP scheduler batch completed",
      limit,
      durationMs,
      ...summary,
    });
  } catch (error: any) {
    console.error("runSchedulerNowWithSecret error", error);
    return res.status(500).json({
      message: "Failed to run RSVP scheduler",
      error: error?.message || "Unknown error",
    });
  }
};

export const triggerSchedulerLambdaRun = async (req: Request, res: Response) => {
  try {
    const functionName = process.env.RSVP_SCHEDULER_LAMBDA_NAME;
    if (!functionName) {
      return res.status(400).json({
        message: "RSVP_SCHEDULER_LAMBDA_NAME is not configured",
      });
    }

    const asyncInvoke = (req.body as any)?.async !== false;
    const limit = parseLimit((req.body as any)?.limit ?? req.query.limit, 50);
    const payload: Record<string, any> = {
      source: "api",
      triggeredAt: new Date().toISOString(),
      limit,
    };
    if (process.env.RSVP_SCHEDULER_SECRET) {
      payload.secret = process.env.RSVP_SCHEDULER_SECRET;
    }

    const lambdaResponse = await invokeLambda(functionName, payload, asyncInvoke);
    return res.json({
      message: asyncInvoke
        ? "RSVP scheduler lambda triggered"
        : "RSVP scheduler lambda executed",
      functionName,
      async: asyncInvoke,
      response: lambdaResponse,
    });
  } catch (error: any) {
    console.error("triggerSchedulerLambdaRun error", error);
    return res.status(500).json({
      message: "Failed to trigger RSVP scheduler lambda",
      error: error?.message || "Unknown error",
    });
  }
};
