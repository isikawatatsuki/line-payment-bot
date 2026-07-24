import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = await readFile(resolve("migrations/001_create_payment_bot_tables.sql"), "utf8");
const connection = await mysql.createConnection({ uri: url, multipleStatements: true });
try {
  await connection.query(sql);
  console.info("Migration completed");
} finally {
  await connection.end();
}
