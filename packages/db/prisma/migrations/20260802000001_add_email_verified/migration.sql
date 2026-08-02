-- AuthSession: track whether the stored email was email_verified at login time
ALTER TABLE "auth_sessions" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;
