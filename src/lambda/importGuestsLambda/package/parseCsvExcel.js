import fetch from 'node-fetch';
import xlsx from 'xlsx';
import csv from 'fast-csv';
import { Readable } from 'stream';
export async function parseCsvExcel(fileUrl) {
    const res = await fetch(fileUrl);
    const buffer = await res.buffer();
    const type = fileUrl.endsWith('.csv') ? 'csv' : 'excel';
    if (type === 'csv') {
        return await new Promise((resolve, reject) => {
            const guests = [];
            Readable.from(buffer.toString())
                .pipe(csv.parse({ headers: true }))
                .on('data', row => guests.push(row))
                .on('end', () => resolve(guests))
                .on('error', reject);
        });
    }
    else {
        const workbook = xlsx.read(buffer);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        return xlsx.utils.sheet_to_json(sheet);
    }
}
