import { updateEventStatuses } from "./utils/eventUtils";

/**
 * Scheduled task to update event statuses
 * This can be called periodically to ensure event statuses are current
 */
export const runScheduledEventStatusUpdate = async () => {
  console.log("🕐 Running scheduled event status update...");
  await updateEventStatuses();
  console.log("✅ Scheduled event status update completed");
};

// Export for potential Lambda scheduling
export const handler = async () => {
  await runScheduledEventStatusUpdate();
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Event statuses updated successfully" })
  };
};