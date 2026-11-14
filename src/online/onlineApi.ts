/**
 * Thin client for the serverless API. Every online mutation funnels through here so the
 * Firebase ID token is attached and server errors surface consistently.
 */

import type { ApiResponse } from './types';

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code = 'unknown', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const API_BASE = '/api';

export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const { method = 'POST', body, token } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'Could not reach the online service. Check your connection.',
      'network',
      0
    );
  }

  const text = await response.text();
  let parsed: ApiResponse<T> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as ApiResponse<T>;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    throw new ApiError(
      response.ok ? 'Malformed server response.' : `Server error (${response.status}).`,
      'bad_response',
      response.status
    );
  }

  if (!parsed.ok) {
    throw new ApiError(parsed.error, parsed.code ?? 'error', response.status);
  }
  return parsed.data;
}

export async function apiGet<T>(path: string, token: string | null): Promise<T> {
  return apiRequest<T>(path, { method: 'GET', token });
}

export async function apiPost<T>(path: string, body: unknown, token: string | null): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body, token });
}
