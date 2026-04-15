import clsx, { type ClassValue } from 'clsx';

/**
 * Tiny classname helper. Wraps clsx so we have one canonical name (`cn`)
 * across the app and a single import path. Add `tailwind-merge` later if
 * we hit class-conflict issues.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
