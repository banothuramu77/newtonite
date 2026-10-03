import jwt from 'jsonwebtoken';
import { JwtPayload } from './types';

const JWT_SECRET = process.env.JWT_SECRET || 'newtonite-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  return decoded as JwtPayload;
}
