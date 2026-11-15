CREATE TABLE "order_sender_code_targets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"sends" integer NOT NULL
);
