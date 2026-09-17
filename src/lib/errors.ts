export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toPublicError(error: unknown, requestId?: string) {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      ...(requestId ? { requestId } : {}),
    },
  };
}
