DROP INDEX "events_user_id_idx";--> statement-breakpoint
CREATE INDEX "events_user_id_occurred_at_idx" ON "events" USING btree ("user_id","occurred_at");