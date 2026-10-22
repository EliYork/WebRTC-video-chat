import path from 'path';
import fileLog from './RotatingFileLog.cjs';

const logFilePath = path.resolve('./logs/node.log');

/**
 * Logger
 *
 * A simple logging utility that writes log messages to a file and, in non-production environments, also to the console.
 *
 * Constructor:
 *   - new Logger(env)
 *     - env: string (e.g., 'production', 'development', etc.)
 *     - Initializes the logger with the given environment and sets the log file path.
 *
 * Methods:
 *   - info(msg: string): void
 *     - Logs an informational message.
 *     - Prepends the message with a timestamp and "INFO".
 *     - Writes the log to the log file and, if not in production, also to the console.
 *
 *   - warn(msg: string): void
 *     - Logs a warning message.
 *     - Prepends the message with a timestamp and "WARN".
 *     - Writes the log to the log file and, if not in production, also to the console.
 *
 *   - error(msg: string): void
 *     - Logs an error message.
 *     - Prepends the message with a timestamp and "ERROR".
 *     - Writes the log to the log file and, if not in production, also to the console.
 *
 * Private Methods:
 *   - #_log(type: string, msg: string): void
 *     - Internal method to format and write the log message.
 *     - Used by info, warn, and error.
 *
 * Example usage:
 *   const logger = new Logger(process.env.ENV);
 *   logger.info('Server started');
 *   logger.warn('Low disk space');
 *   logger.error('Unhandled exception');
 */
export default class Logger {
    constructor(env) {
        this.env = env;
        this.logFilePath = logFilePath;
        this.fileLog = fileLog.createFileLog({ filePath: () => this.logFilePath, maxBytes: 10 * 1024 * 1024 });
    }

    get writeFailed() { return this.fileLog.writeFailed; }

    #_log(type, msg) {
        const line = `${this.#_getTimestamp()} ${type}  ${msg}`;
        this.fileLog.write(line);
        if (this.env !== 'production') {
            // eslint-disable-next-line no-console
            console.log(line);
        }
    }

    #_pad(num, size = 2) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }

    #_getTimestamp() {
        const now = new Date();
        const weekday = now.toLocaleString('en-US', { weekday: 'long' });
        const day = this.#_pad(now.getDate());
        const month = this.#_pad(now.getMonth() + 1); // Months are zero-based
        const year = now.getFullYear();
        const h = this.#_pad(now.getHours());
        const m = this.#_pad(now.getMinutes());
        const s = this.#_pad(now.getSeconds());
        const ms = this.#_pad(now.getMilliseconds(), 3);
        return `${weekday} ${day}/${month}/${year} ${h}:${m}:${s}.${ms}`;
    }

    info(msg) {
        this.#_log('INFO', msg);
    }

    warn(msg) {
        this.#_log('WARN', msg);
    }

    error(msg) {
        this.#_log('ERROR', msg);
    }
}
