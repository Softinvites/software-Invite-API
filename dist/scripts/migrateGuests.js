import dotenv from 'dotenv';
import { Guest } from '../models/guestmodel';
dotenv.config();
const guestsToMigrate = await Guest.find({
    $and: [
        { firstName: { $exists: true } },
        { lastName: { $exists: true } },
        {
            $or: [
                { fullname: { $exists: false } },
                { TableNo: { $exists: false } },
            ]
        }
    ]
}); // 👈 Type assertion here
for (const guest of guestsToMigrate) {
    guest.fullname = guest.firstName?.trim() || '';
    guest.TableNo = guest.lastName?.trim() || '';
    await guest.save();
    console.log(`✔️ Migrated guest ${guest._id} to fullname and TableNo`);
}
