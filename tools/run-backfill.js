"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const backfill_pngs_1 = require("./backfill-pngs");
// This is the Lambda handler that will be executed.
const handler = async () => {
    console.log('Starting backfill process with hardcoded arguments...');
    const opts = {
        eventId: '692adb9d3426fe43f2f281a3',
        dryRun: false,
        generateMissing: true // Corresponds to the '--generate' flag
    };
    try {
        await (0, backfill_pngs_1.backfill)(opts);
        console.log('Backfill process completed successfully.');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Backfill successful.' }),
        };
    }
    catch (error) {
        console.error('Backfill process failed:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Backfill failed.', error: error.message }),
        };
    }
};
exports.handler = handler;
