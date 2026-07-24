import { Kysely, MysqlDialect } from "kysely";
import mysql from "mysql2";
import type { Database } from "./schema.js";

let database: Kysely<Database> | undefined;

export function getDatabase(url = process.env.DATABASE_URL): Kysely<Database> {
  if (!url) throw new Error("DATABASE_URL is required");
  if (!database) {
    database = new Kysely<Database>({
      dialect: new MysqlDialect({ pool: mysql.createPool(url) })
    });
  }
  return database;
}
