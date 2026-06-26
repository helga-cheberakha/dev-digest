import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type PrIntentRow = typeof t.prIntent.$inferSelect;

export class IntentRepository {
  constructor(private db: Db) {}

  async findByPrId(prId: string): Promise<PrIntentRow | null> {
    const [row] = await this.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    return row ?? null;
  }

  async upsert(data: {
    prId: string;
    summary: string;
    inScope: string[];
    outOfScope: string[];
    riskAreas?: string[] | null;
    model: string;
    tokensSaved?: number | null;
  }): Promise<PrIntentRow> {
    const [row] = await this.db
      .insert(t.prIntent)
      .values({
        prId: data.prId,
        summary: data.summary,
        inScope: data.inScope,
        outOfScope: data.outOfScope,
        riskAreas: data.riskAreas ?? null,
        model: data.model,
        tokensSaved: data.tokensSaved ?? null,
      })
      .onConflictDoUpdate({
        target: [t.prIntent.prId],
        set: {
          summary: data.summary,
          inScope: data.inScope,
          outOfScope: data.outOfScope,
          riskAreas: data.riskAreas ?? null,
          model: data.model,
          tokensSaved: data.tokensSaved ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }
}
