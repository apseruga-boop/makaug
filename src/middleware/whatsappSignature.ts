import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyWhatsAppSignature(req: Request, res: Response, next: NextFunction): void {
  if (!env.waAppSecret) {
    next();
    return;
  }

  const signature = req.header('x-hub-signature-256');
  if (!signature || !req.rawBody) {
    res.status(401).json({ ok: false, error: 'Missing WhatsApp signature' });
    return;
  }

  const digest = crypto.createHmac('sha256', env.waAppSecret).update(req.rawBody).digest('hex');
  const expected = `sha256=${digest}`;

  if (!safeCompare(signature, expected)) {
    res.status(401).json({ ok: false, error: 'Invalid WhatsApp signature' });
    return;
  }

  next();
}
