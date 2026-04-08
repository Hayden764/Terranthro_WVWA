import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL || '';
const isNeon      = dbUrl.includes('neon.tech');
const isSupabase  = dbUrl.includes('supabase.co') || dbUrl.includes('supabase.com');
const needsSsl    = isNeon || isSupabase;

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  // Supabase connection pooler (Transaction mode) caps prepared statements
  max: isSupabase ? 10 : 20,
});

// Neon omits public from search_path by default
if (isNeon) {
  pool.on('connect', (client) => {
    client.query('SET search_path TO public');
  });
}

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});
