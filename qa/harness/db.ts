import mongoose from "mongoose";
import { readBackendEnv, deriveTestMongoUri } from "./env.js";

let conn: mongoose.Connection | null = null;

/** A QA-owned connection to the TEST database. Separate from the server's own pool. */
export async function testDb(): Promise<mongoose.Connection> {
  if (conn && conn.readyState === 1) return conn;
  const be = readBackendEnv();
  const uri = deriveTestMongoUri(be.MONGODB_URI);
  const m = await mongoose.createConnection(uri).asPromise();
  conn = m;
  return conn;
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
