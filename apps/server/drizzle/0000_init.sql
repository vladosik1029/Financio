CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"balance_after" double precision NOT NULL,
	"position_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"leverage" integer NOT NULL,
	"margin" double precision NOT NULL,
	"invested" double precision NOT NULL,
	"quantity" double precision NOT NULL,
	"entry_price" double precision NOT NULL,
	"liquidation_price" double precision NOT NULL,
	"take_profit" double precision,
	"stop_loss" double precision,
	"open_fee" double precision NOT NULL,
	"close_fee" double precision DEFAULT 0 NOT NULL,
	"funding_paid" double precision DEFAULT 0 NOT NULL,
	"exit_price" double precision,
	"realized_pnl" double precision,
	"close_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"username" text,
	"language_code" text,
	"balance" double precision NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"last_loan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "positions_user_status_idx" ON "positions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "positions_status_idx" ON "positions" USING btree ("status");