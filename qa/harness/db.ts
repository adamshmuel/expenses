import mongoose from "mongoose";
import { readBackendEnv, deriveTestMongoUri } from "./env.js";
import { LIVED_IN_DB_NAME } from "./paths.js";

let conn: mongoose.Connection | null = null;
let livedInConn: mongoose.Connection | null = null;

/** A QA-owned connection to the TEST database. Separate from the server's own pool. */
export async function testDb(): Promise<mongoose.Connection> {
  if (conn && conn.readyState === 1) return conn;
  const be = readBackendEnv();
  const uri = deriveTestMongoUri(be.MONGODB_URI);
  const m = await mongoose.createConnection(uri).asPromise();
  conn = m;
  return conn;
}

/** A read-side QA connection to the persistent lived-in database, for the
 *  DATA SWEEP halves of LV-18..LV-22 -- a direct query over the whole
 *  collection, not a request through the app. Never drops this database. */
export async function livedInDb(): Promise<mongoose.Connection> {
  if (livedInConn && livedInConn.readyState === 1) return livedInConn;
  const be = readBackendEnv();
  const uri = deriveTestMongoUri(be.MONGODB_URI, LIVED_IN_DB_NAME);
  const m = await mongoose.createConnection(uri).asPromise();
  livedInConn = m;
  return livedInConn;
}

export async function countCollection(name: string): Promise<number> {
  const db = await testDb();
  return db.collection(name).countDocuments();
}

export async function dropTestDb(): Promise<void> {
  const db = await testDb();
  await db.dropDatabase();
}

export async function closeTestDb(): Promise<void> {
  if (conn) {
    await conn.close();
    conn = null;
  }
}
