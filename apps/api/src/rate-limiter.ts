import type { Sql, TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret, type Clock } from "./security.js";

export type RateLimitCommand = Readonly<{
  action: string;
  limit: number;
  subject: string;
  windowMs: number;
}>;

export interface RateLimiter {
  consume(command: RateLimitCommand): Promise<boolean> | boolean;
}

export async function enforceRateLimit(
  limiter: RateLimiter,
  command: RateLimitCommand,
): Promise<void> {
  if (!(await limiter.consume(command))) {
    throw new CloudFault("rate_limited", "Too many requests. Try again later.");
  }
}

export function createInMemoryRateLimiter(clock: Clock): RateLimiter {
  const counts = new Map<string, number>();
  return {
    consume(command) {
      const windowStart = Math.floor(clock.now().getTime() / command.windowMs) * command.windowMs;
      const key = `${command.action}:${command.subject}:${windowStart}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= command.limit;
    },
  };
}

export function createPostgresRateLimiter(options: {
  clock: Clock;
  pepper: string;
  sql: Sql;
}): RateLimiter {
  async function trusted<T>(operation: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return options.sql.begin(async (sql) => {
      await sql`SET LOCAL ROLE huayi_context_setter`;
      return operation(sql);
    }) as Promise<T>;
  }

  return {
    async consume(command) {
      const windowStart = new Date(
        Math.floor(options.clock.now().getTime() / command.windowMs) * command.windowMs,
      );
      const [result] = await trusted(
        (sql) => sql<{ allowed: boolean }[]>`
          SELECT consume_rate_limit(
            ${hashSecret(command.subject, options.pepper)}, ${command.action},
            ${windowStart}, ${command.limit}
          ) AS allowed
        `,
      );
      return result?.allowed === true;
    },
  };
}
