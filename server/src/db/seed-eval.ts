/**
 * Seed ≥8 eval cases for the General Reviewer agent (AC-17).
 *
 * Idempotent: skips insertion when cases already exist for the target agent.
 * Each case's `expected_output` is validated with `EvalExpectedOutput.parse()`
 * before insertion — an invalid payload throws at seed time, not silently.
 *
 * Cases cover a realistic mix of `must_find` (6) and `must_not_flag` (2)
 * expectations across security, perf, and bug categories so the agent's
 * dashboard shows `alert: null` (≥8 cases, no historical regressions).
 */
import type { Db } from './client.js';
import * as t from './schema.js';
import { and, eq } from 'drizzle-orm';
import { EvalExpectedOutput } from '../vendor/shared/contracts/eval-ci.js';

// ---------------------------------------------------------------------------
// Eval case definitions
// ---------------------------------------------------------------------------

interface EvalCaseDef {
  name: string;
  inputDiff: string;
  expectedOutput: {
    expectation: 'must_find' | 'must_not_flag';
    regions: Array<{
      file: string;
      start_line: number;
      end_line: number;
      severity?: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
      category?: 'bug' | 'security' | 'perf' | 'style' | 'test';
    }>;
  };
  notes?: string;
}

const EVAL_CASES: EvalCaseDef[] = [
  // ----- must_find -----

  {
    name: 'hardcoded-api-key-in-config',
    notes: 'Agent must flag a plaintext Stripe secret added to src/config.ts.',
    inputDiff: `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,4 +1,5 @@
 export const config = {
   port: 3000,
+  stripeKey: 'sk_live_supersecretkey12345678',
   db: process.env.DATABASE_URL ?? '',
 };`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/config.ts',
          start_line: 3,
          end_line: 3,
          severity: 'CRITICAL',
          category: 'security',
        },
      ],
    },
  },

  {
    name: 'n-plus-one-query-in-user-loop',
    notes: 'Agent must flag a DB query issued once per iteration inside a for-of loop.',
    inputDiff: `diff --git a/src/api/orders.ts b/src/api/orders.ts
--- a/src/api/orders.ts
+++ b/src/api/orders.ts
@@ -5,6 +5,11 @@
 export async function getOrdersWithItems(userId: string) {
   const orders = await db.select().from(t.orders)
     .where(eq(t.orders.userId, userId));
+  for (const order of orders) {
+    order.items = await db.select().from(t.orderItems)
+      .where(eq(t.orderItems.orderId, order.id));
+  }
   return orders;
 }`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/api/orders.ts',
          start_line: 8,
          end_line: 11,
          severity: 'WARNING',
          category: 'perf',
        },
      ],
    },
  },

  {
    name: 'sql-injection-via-string-concat',
    notes: 'Agent must flag raw string concatenation used to build a SQL query.',
    inputDiff: `diff --git a/src/db/search.ts b/src/db/search.ts
--- a/src/db/search.ts
+++ b/src/db/search.ts
@@ -1,5 +1,7 @@
 import { pool } from './pool.js';

+export async function searchUsers(name: string) {
+  const rows = await pool.query('SELECT * FROM users WHERE name = \\'' + name + '\\'');
+  return rows;
+}`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/db/search.ts',
          start_line: 3,
          end_line: 5,
          severity: 'CRITICAL',
          category: 'security',
        },
      ],
    },
  },

  {
    name: 'missing-error-handling-async-webhook',
    notes: 'Agent must flag a fire-and-forget async call with no error path.',
    inputDiff: `diff --git a/src/handlers/webhook.ts b/src/handlers/webhook.ts
--- a/src/handlers/webhook.ts
+++ b/src/handlers/webhook.ts
@@ -3,5 +3,8 @@
 export function handleWebhook(payload: unknown) {
   validatePayload(payload);
+  // process asynchronously with no await and no catch
+  processPayload(payload as WebhookPayload);
   log.info('webhook received');
 }`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/handlers/webhook.ts',
          start_line: 6,
          end_line: 6,
          severity: 'WARNING',
          category: 'bug',
        },
      ],
    },
  },

  {
    name: 'null-dereference-without-guard',
    notes: 'Agent must flag access to a property on a value that may be undefined.',
    inputDiff: `diff --git a/src/utils/transform.ts b/src/utils/transform.ts
--- a/src/utils/transform.ts
+++ b/src/utils/transform.ts
@@ -4,5 +4,7 @@
 export function getUserCity(user: User | undefined): string {
   // No guard — user may be undefined
+  return user.address.city;
 }`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/utils/transform.ts',
          start_line: 6,
          end_line: 6,
          severity: 'WARNING',
          category: 'bug',
        },
      ],
    },
  },

  {
    name: 'race-condition-shared-counter',
    notes: 'Agent must flag concurrent mutation of a shared mutable counter.',
    inputDiff: `diff --git a/src/workers/processor.ts b/src/workers/processor.ts
--- a/src/workers/processor.ts
+++ b/src/workers/processor.ts
@@ -5,6 +5,11 @@
 let processed = 0;

+export async function processAll(items: Item[]) {
+  await Promise.all(items.map(async (item) => {
+    await processOne(item);
+    processed++;
+  }));
+}`,
    expectedOutput: {
      expectation: 'must_find',
      regions: [
        {
          file: 'src/workers/processor.ts',
          start_line: 8,
          end_line: 11,
          severity: 'WARNING',
          category: 'bug',
        },
      ],
    },
  },

  // ----- must_not_flag -----

  {
    name: 'should-not-flag-parseInt-with-radix',
    notes: 'Agent must NOT flag standard parseInt(str, 10) usage — this is correct code.',
    inputDiff: `diff --git a/src/api/items.ts b/src/api/items.ts
--- a/src/api/items.ts
+++ b/src/api/items.ts
@@ -1,4 +1,6 @@
 import { Request, Response } from 'express';

+export function getItem(req: Request, res: Response) {
+  const id = parseInt(req.params.id ?? '0', 10);
+  res.json({ id });
+}`,
    expectedOutput: {
      expectation: 'must_not_flag',
      regions: [
        {
          file: 'src/api/items.ts',
          start_line: 3,
          end_line: 5,
        },
      ],
    },
  },

  {
    name: 'should-not-flag-correct-async-await',
    notes: 'Agent must NOT flag a properly-awaited async function with error handling.',
    inputDiff: `diff --git a/src/services/email.ts b/src/services/email.ts
--- a/src/services/email.ts
+++ b/src/services/email.ts
@@ -2,5 +2,10 @@

+export async function sendWelcomeEmail(userId: string): Promise<void> {
+  try {
+    const user = await userRepo.findById(userId);
+    await mailer.send({ to: user.email, template: 'welcome' });
+  } catch (err) {
+    log.error({ err, userId }, 'failed to send welcome email');
+  }
+}`,
    expectedOutput: {
      expectation: 'must_not_flag',
      regions: [
        {
          file: 'src/services/email.ts',
          start_line: 3,
          end_line: 10,
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// seedEvalCases
// ---------------------------------------------------------------------------

/**
 * Insert eval cases for the given agent if none exist yet.
 * Validates each payload with `EvalExpectedOutput.parse()` — throws on
 * schema mismatch so invalid seed data is caught at seed time, not silently
 * swallowed by the write path.
 */
export async function seedEvalCases(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<void> {
  // Idempotency guard: skip if any cases already exist for this agent
  const existing = await db
    .select({ id: t.evalCases.id })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerId, agentId),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  for (const def of EVAL_CASES) {
    // Validate the expected_output shape — throws with a clear Zod error if invalid
    const expectedOutput = EvalExpectedOutput.parse(def.expectedOutput);

    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: def.name,
      inputDiff: def.inputDiff,
      expectedOutput,
      notes: def.notes ?? null,
    });
  }
}
