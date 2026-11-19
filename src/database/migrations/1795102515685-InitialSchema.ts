import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1795102515685 implements MigrationInterface {
  name = 'InitialSchema1795102515685';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "email" character varying(320) NOT NULL,
                "password_hash" text NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")
        `);
    await queryRunner.query(`
            CREATE TABLE "notes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "title" character varying(200) NOT NULL,
                "body" text NOT NULL DEFAULT '',
                "tags" text array NOT NULL DEFAULT '{}',
                "pinned" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_af6206538ea96c4e77e9f400c3d" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_711a0447a29a696b7989f23c1c" ON "notes" ("user_id", "updated_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "oauth_entries" (
                "model" character varying(64) NOT NULL,
                "id" character varying(255) NOT NULL,
                "payload" jsonb NOT NULL,
                "grant_id" character varying(255),
                "user_code" character varying(255),
                "uid" character varying(255),
                "expires_at" TIMESTAMP WITH TIME ZONE,
                "consumed_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_e3a1091ebeb5d5c8dce2e4e7d63" PRIMARY KEY ("model", "id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_a260f929c6e73ef638f755fc8e" ON "oauth_entries" ("grant_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_d3d87abcbd2e724d6f71de6cfe" ON "oauth_entries" ("user_code")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_681b376ef42dd5cae905304c41" ON "oauth_entries" ("uid")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_1c9fa766c72aab7d68b55d31b5" ON "oauth_entries" ("expires_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "tasks" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "title" character varying(200) NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "status" character varying(8) NOT NULL DEFAULT 'open',
                "priority" character varying(8) NOT NULL DEFAULT 'normal',
                "due_date" date,
                "note_id" uuid,
                "completed_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_9ca53dea8552db10ff25c9c153" ON "tasks" ("user_id", "status", "due_date")
        `);
    await queryRunner.query(`
            ALTER TABLE "notes"
            ADD CONSTRAINT "FK_7708dcb62ff332f0eaf9f0743a7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_db55af84c226af9dce09487b61b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_615a6b431c095b5fe1247612c6b" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_615a6b431c095b5fe1247612c6b"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_db55af84c226af9dce09487b61b"
        `);
    await queryRunner.query(`
            ALTER TABLE "notes" DROP CONSTRAINT "FK_7708dcb62ff332f0eaf9f0743a7"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_9ca53dea8552db10ff25c9c153"
        `);
    await queryRunner.query(`
            DROP TABLE "tasks"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_1c9fa766c72aab7d68b55d31b5"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_681b376ef42dd5cae905304c41"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_d3d87abcbd2e724d6f71de6cfe"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_a260f929c6e73ef638f755fc8e"
        `);
    await queryRunner.query(`
            DROP TABLE "oauth_entries"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_711a0447a29a696b7989f23c1c"
        `);
    await queryRunner.query(`
            DROP TABLE "notes"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"
        `);
    await queryRunner.query(`
            DROP TABLE "users"
        `);
  }
}
