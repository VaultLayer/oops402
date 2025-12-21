/**
 * Authentication utility functions
 */

/**
 * Checks if a response contains an authentication error and redirects to login if needed
 * @param response - The fetch Response object
 * @param data - Optional parsed JSON data from the response (if already read)
 * @returns true if authentication error was detected and redirect was triggered, false otherwise
 */
export async function checkAuthError(response: Response, data?: any): Promise<boolean> {
  // Check for 401 status code
  if (response.status === 401) {
    window.location.href = "/login";
    return true;
  }

  // Check response body for authentication error message
  // If data is already provided, use it. Otherwise, clone the response to avoid consuming the stream
  try {
    let responseData = data;
    if (!responseData) {
      // Clone the response so we don't consume the original stream
      const clonedResponse = response.clone();
      responseData = await clonedResponse.json();
    }
    if (responseData?.error === "Authentication required") {
      window.location.href = "/login";
      return true;
    }
  } catch {
    // If we can't parse JSON, that's fine - we'll just check status code
  }

  return false;
}

/**
 * Wrapper for fetch that automatically handles authentication errors
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @returns The fetch Response, or null if authentication error was detected
 */
export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response | null> {
  const response = await fetch(url, options);
  
  if (await checkAuthError(response)) {
    return null;
  }

  return response;
}

