/**
 * Shared x402 schema validation logic
 * Extracted from /api/discover/schema endpoint for reuse in promotion validation
 */

import { logger } from '../shared/logger.js';

export interface X402SchemaValidationResult {
  hasX402Schema: boolean;
  schema: any;
  headers: Record<string, string>;
  contentType?: string | null;
  status: number;
}

/**
 * Discover and validate x402 schema from a URL
 */
export async function validateX402Resource(
  url: string,
  method: string = 'GET'
): Promise<X402SchemaValidationResult> {
  // Make a request without payment to discover the schema
  // x402 resources typically return payment requirements in response headers/body
  logger.debug('Discovering x402 schema', { url, method });
  
  const response = await fetch(url, {
    method: method as string,
    headers: {
      'Accept': 'application/json',
    },
  });

  // Try to parse response as JSON (x402 schema is typically in JSON format)
  let schemaData: any = null;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    try {
      schemaData = await response.json();
    } catch (e) {
      // If JSON parsing fails, try to get text
      schemaData = { raw: await response.text() };
    }
  } else {
    schemaData = { raw: await response.text() };
  }

  // Extract x402 headers if present
  const x402Headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-x402-') || key.toLowerCase().startsWith('x-402-')) {
      x402Headers[key] = value;
    }
  });

  // Check if response contains x402 schema (has accepts array or x402Version)
  const hasX402Schema = schemaData && (
    schemaData.accepts ||
    schemaData.x402Version !== undefined ||
    Object.keys(x402Headers).length > 0
  );

  return {
    hasX402Schema,
    schema: schemaData,
    headers: x402Headers,
    contentType,
    status: response.status,
  };
}

