import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeDatabase } from './schema';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/newtonite.db');

// Ensure data directory exists (skip for :memory: databases)
if (DB_PATH !== ':memory:') {
  const dataDir = path.dirname(DB_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: Database.Database = new Database(DB_PATH);

initializeDatabase(db);

export default db;
