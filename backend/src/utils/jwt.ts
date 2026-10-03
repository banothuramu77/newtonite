import jwt from 'jsonwebtoken';
import { JwtPayload } from './types';

const JWT_EXPIRES_IN = '7d';
const DEVELOPMENT_JWT_SECRET = 'newtonite-local-development-secret';

function getJwtSecret(): string {
  const configuredSecret = process.env.JWT_SECRET;
  if (configuredSecret) {
    if (process.env.NODE_ENV === 'production' && configuredSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production');
  }
  return DEVELOPMENT_JWT_SECRET;
}

export function assertJwtSecretConfigured(): void {
  getJwtSecret();
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  return decoded as JwtPayload;
}
