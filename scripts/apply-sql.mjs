// Apply an additive SQL file to the (shared) Neon database:
//   node scripts/apply-sql.mjs prisma/sql/001_qt_scores.sql
// Refuses statements that drop or truncate anything.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-sql.mjs <file.sql>'); process.exit(1); }
const sql = readFileSync(file, 'utf8');
const code = sql.replace(/--.*$/gm, '');
if (/\b(drop|truncate|delete)\b/i.test(code)) { console.error('Refusing: file contains DROP/TRUNCATE/DELETE'); process.exit(1); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log(`applied ${file}`);
} finally {
  await client.end();
}
