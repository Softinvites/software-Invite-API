import { Event } from "../models/eventmodel";

/**
 * Updates all events' status based on their expiration (2 days after event date)
 */
export const updateEventStatuses = async (): Promise<void> => {
  try {
    const events = await Event.find({});
    
    for (const event of events) {
      const currentStatus = event.getEventStatus();
      if (event.eventStatus !== currentStatus) {
        event.eventStatus = currentStatus;
        await event.save();
        console.log(`Updated event ${event.name} eventStatus to: ${currentStatus}`);
      }
    }
  } catch (error) {
    console.error("Error updating event statuses:", error);
  }
};

/**
 * Check if an event is currently active and not expired
 */
export const isEventActive = (event: any): boolean => {
  return event.isActive && event.getEventStatus() === "active";
};