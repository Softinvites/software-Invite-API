"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const backfill_pngs_1 = require("./backfill-pngs");
const handler = async (event) => {
    const opts = {
        eventId: event.eventId,
        dryRun: !event.apply,
        generateMissing: event.generate,
    };
    console.log('Running backfill with options:', opts);
    await (0, backfill_pngs_1.backfill)(opts);
    console.log('Backfill complete.');
};
exports.handler = handler;
