import type { Request, Response } from 'express';
import { dbHealthcheck } from '../config/database';

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  try {
    const now = await dbHealthcheck();
    res.status(200).json({ ok: true, database: 'up', now });
  } catch (error) {
    res.status(500).json({ ok: false, database: 'down', error: (error as Error).message });
  }
}
