/**
 * Supabase client initialization
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { logger } from './logger.js';

// Initialize Supabase client with service role key for server-side operations
export function getSupabaseClient() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error('Supabase URL and service role key must be configured');
  }

  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Initialize Supabase client with anon key for client-side operations (if needed)
export function getSupabaseAnonClient() {
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new Error('Supabase URL and anon key must be configured');
  }

  return createClient(config.supabase.url, config.supabase.anonKey);
}

/**
 * Hash a session ID for privacy-compliant analytics
 */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

