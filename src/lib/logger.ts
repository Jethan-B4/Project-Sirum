const IS_DEV = process.env.NODE_ENV !== 'production';

export const logger = {
  info(msg: string, data?: object): void {
    if (IS_DEV) {
      if (data !== undefined) {
        console.log(`[info] ${msg}`, data);
      } else {
        console.log(`[info] ${msg}`);
      }
    }
  },

  warn(msg: string, data?: object): void {
    if (IS_DEV) {
      if (data !== undefined) {
        console.warn(`[warn] ${msg}`, data);
      } else {
        console.warn(`[warn] ${msg}`);
      }
    }
  },

  error(msg: string, error?: unknown, data?: object): void {
    if (IS_DEV) {
      if (data !== undefined) {
        console.error(`[error] ${msg}`, error, data);
      } else {
        console.error(`[error] ${msg}`, error);
      }
    }
  },

  sync(msg: string, data?: object): void {
    if (IS_DEV) {
      if (data !== undefined) {
        console.log(`[sync] ${msg}`, data);
      } else {
        console.log(`[sync] ${msg}`);
      }
    }
  },
};
