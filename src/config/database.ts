import { Pool, type PoolClient, type QueryResult } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('Postgres pool error', error);
});

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function dbHealthcheck(): Promise<string> {
  const result = await query<{ now: string }>('SELECT NOW()::text as now');
  return result.rows[0]?.now ?? '';
}
