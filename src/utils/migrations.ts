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

/**
 * Drops the legacy unique index `eventId_1_email_1` from the guests
 * collection. Two guests sharing one email address is legitimate — families
 * and couples do it constantly — and the unique index rejected the second
 * guest on import.
 *
 * Removing `unique: true` from the schema does not drop an index Mongo has
 * already built, so this has to run explicitly.
 */
export const dropGuestEmailUniqueIndex = async () => {
  try {
    const collection = mongoose.connection.collection("guests");
    const indexes = await collection.indexes();
    const legacyIndex = indexes.find(
      (idx) =>
        idx.unique === true &&
        Object.keys(idx.key).length === 2 &&
        idx.key.eventId === 1 &&
        idx.key.email === 1,
    );

    if (legacyIndex?.name) {
      await collection.dropIndex(legacyIndex.name);
      console.log(
        `✅ Dropped unique index ${legacyIndex.name} from guests — guests may now share an email`,
      );
    }
  } catch (err: any) {
    if (err?.codeName !== "IndexNotFound" && err?.code !== 27) {
      console.warn(
        "⚠️ Could not drop guests email unique index:",
        err?.message || err,
      );
    }
  }
};
