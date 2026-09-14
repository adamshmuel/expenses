import { dropTestDb, closeTestDb } from "../harness/db.js";

/** Leave nothing behind: drop the test DB. Playwright itself stops the webServers. */
export default async function globalTeardown() {
  await dropTestDb();
  await closeTestDb();
}
