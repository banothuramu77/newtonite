const BASE_URL = '/api';

function getToken(): string | null {
  return localStorage.getItem('newtonite-token');
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.pathname + url.search;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem('newtonite-token');
    localStorage.removeItem('newtonite-auth');
    window.location.href = '/login';
    throw new Error('401: Unauthorized');
  }

  if (!response.ok) {
    let message = `${response.status}: ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.error) message = `${response.status}: ${body.error}`;
      else if (body.message) message = `${response.status}: ${body.message}`;
    } catch {
      // The response body may not contain JSON.
    }
    throw new Error(message);
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function buildHeaders(idempotencyKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  return headers;
}

export const apiClient = {
  get: async <T>(path: string, params?: Record<string, unknown>): Promise<T> => {
    const response = await fetch(buildUrl(path, params), {
      method: 'GET',
      headers: buildHeaders(),
    });
    return handleResponse<T>(response);
  },

  post: async <T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(idempotencyKey),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  put: async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  delete: async <T>(path: string): Promise<T> => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    });
    return handleResponse<T>(response);
  },
};
