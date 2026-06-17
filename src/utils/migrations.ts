import mongoose from "mongoose";

/**
 * Drops the legacy unique index `name_1` from the whatsapptemplates collection.
 * The correct compound index is `eventId_1_name_1` which allows the same template
 * name across different events.
 */
export const dropLegacyWhatsAppTemplateIndex = async () => {
  try {
    const collection = mongoose.connection.collection("whatsapptemplates");
    const indexes = await collection.indexes();
    const legacyIndex = indexes.find(
      (idx) =>
        idx.name === "name_1" &&
        idx.unique === true &&
        Object.keys(idx.key).length === 1 &&
        idx.key.name === 1
    );

    if (legacyIndex) {
      await collection.dropIndex("name_1");
      console.log("✅ Dropped legacy unique index name_1 from whatsapptemplates");
    }
  } catch (err: any) {
    // Index may not exist — safe to ignore
    if (err?.codeName !== "IndexNotFound") {
      console.warn("⚠️ Could not drop legacy whatsapptemplates index:", err?.message || err);
    }
  }
};
