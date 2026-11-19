import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Storage for the OAuth server: authorization codes, refresh tokens,
 * grants, sessions, registered clients and so on. Each row is one item of
 * one kind (`model`), stored as JSON with an expiry time.
 */
@Entity({ name: 'oauth_entries' })
export class OAuthEntry {
  /** What kind of item: AuthorizationCode, RefreshToken, Grant, Client... */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  model: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Lets "revoke everything from this grant" find all its tokens. */
  @Index()
  @Column({ type: 'varchar', length: 255, name: 'grant_id', nullable: true })
  grantId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 255, name: 'user_code', nullable: true })
  userCode: string | null;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  uid: string | null;

  @Index()
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  /** Set when a single-use item (like an authorization code) is used. */
  @Column({ type: 'timestamptz', name: 'consumed_at', nullable: true })
  consumedAt: Date | null;
}
