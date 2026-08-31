/**
 * Application domain errors.
 */

export class AppError extends Error {
  constructor(message: string, public readonly code: string = "APP_ERROR") {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
  }
}

export class ClientError extends AppError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, "CLIENT_ERROR");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}
