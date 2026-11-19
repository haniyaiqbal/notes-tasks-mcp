import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { DataSource } from 'typeorm';

/**
 * Stores oidc-provider's data (codes, tokens, grants, sessions, clients) in
 * Postgres, so it survives restarts and works with several app instances.
 * The library's default keeps everything in memory, which is for demos only.
 */
export class PostgresAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly db: DataSource,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number) {
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
    const values = [
      this.model,
      id,
      payload,
      payload.grantId ?? null,
      payload.userCode ?? null,
      payload.uid ?? null,
      expiresAt,
    ];

    if (this.model === 'ReplayDetection') {
      // Must be insert-only: a second use of the same proof is an attack,
      // so it has to fail, not overwrite.
      const rows = await this.db.query(
        `INSERT INTO oauth_entries (model, id, payload, grant_id, user_code, uid, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (model, id) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at
           WHERE oauth_entries.expires_at IS NOT NULL AND oauth_entries.expires_at <= now()
         RETURNING id`,
        values,
      );
      if (rows.length === 0) throw new Error('Replay detected');
      return;
    }

    await this.db.query(
      `INSERT INTO oauth_entries (model, id, payload, grant_id, user_code, uid, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (model, id) DO UPDATE SET
         payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id,
         user_code = EXCLUDED.user_code, uid = EXCLUDED.uid,
         expires_at = EXCLUDED.expires_at, consumed_at = NULL`,
      values,
    );
  }

  find(id: string) {
    return this.findBy('id', id);
  }

  findByUid(uid: string) {
    return this.findBy('uid', uid);
  }

  findByUserCode(userCode: string) {
    return this.findBy('user_code', userCode);
  }

  /**
   * Marks a single-use item (an authorization code) as used. Atomic: if two
   * requests race to use the same code, only one of them wins.
   */
  async consume(id: string) {
    const [rows] = await this.db.query(
      `UPDATE oauth_entries SET consumed_at = now()
        WHERE model = $1 AND id = $2 AND consumed_at IS NULL
        RETURNING id`,
      [this.model, id],
    );
    if (!rows?.length) throw new Error('Already consumed');
  }

  async destroy(id: string) {
    await this.db.query(
      `DELETE FROM oauth_entries WHERE model = $1 AND id = $2`,
      [this.model, id],
    );
  }

  /** Revoking a grant removes every token that came from it. */
  async revokeByGrantId(grantId: string) {
    await this.db.query(`DELETE FROM oauth_entries WHERE grant_id = $1`, [
      grantId,
    ]);
  }

  private async findBy(column: 'id' | 'uid' | 'user_code', value: string) {
    const rows: { payload: AdapterPayload; consumed_at: Date | null }[] =
      await this.db.query(
        `SELECT payload, consumed_at FROM oauth_entries
        WHERE model = $1 AND ${column} = $2
          AND (expires_at IS NULL OR expires_at > now())`,
        [this.model, value],
      );
    const row = rows[0];
    if (!row) return undefined;
    return row.consumed_at ? { ...row.payload, consumed: true } : row.payload;
  }
}

/** Expired rows are useless; delete them now and then. */
export async function deleteExpiredEntries(db: DataSource): Promise<number> {
  const [, count] = await db.query(
    `DELETE FROM oauth_entries WHERE expires_at IS NOT NULL AND expires_at < now() - interval '1 day'`,
  );
  return count ?? 0;
}
