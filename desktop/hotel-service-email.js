"use strict";

let flushing = null;

async function flushGuestServiceEmails(db) {
  if (!db || typeof db.listDueGuestServiceEmails !== "function") return { sent: 0 };
  if (flushing) return flushing;
  flushing = flushNow(db).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function flushNow(db) {
  const hotelCloudSync = require("./hotel-cloud-sync");
  const rows = db.listDueGuestServiceEmails();
  let sent = 0;
  for (const row of rows) {
    try {
      await hotelCloudSync.sendGuestServiceEmail(db, {
        to: row.to_email,
        subject: row.subject,
        text: row.body,
      });
      db.markGuestServiceEmailSent(row.id);
      sent += 1;
    } catch (err) {
      db.markGuestServiceEmailFailed(row.id, err?.message || err);
    }
  }
  return { sent, pending: rows.length - sent };
}

module.exports = { flushGuestServiceEmails };
