import pino, { type Logger } from 'pino';
import { getEnv } from '../config/env.js';

let cached: Logger | undefined;

export function createLogger(name?: string): Logger {
  const env = getEnv();
  const options: pino.LoggerOptions = {
    level: env.LOG_LEVEL,
  };

  if (name) {
    options.name = name;
  }

  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    };
  }

  return pino(options);
}

export function getLogger(): Logger {
  if (!cached) {
    cached = createLogger('app');
  }
  return cached;
}

/** Lazy proxy so importing modules does not require env at load time. */
export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, receiver) {
    const real = getLogger();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
