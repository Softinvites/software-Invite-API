import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://8375301ae290dc7f364f382e9d2c96ad@o4510460575219712.ingest.us.sentry.io/4510460577447936",
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
  integrations: [
    nodeProfilingIntegration(),
  ],
});

export default Sentry;