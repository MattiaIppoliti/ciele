// The env template the fakes pretend `deploy/.env.example` contains.
//
// One constant for both consumers: the engine's unit tests and the app's
// `--fake-ports` mode, and pinned to the real template by env-template.test.ts,
// so a key that exists here but not in deploy/.env.example (or a wizard that no
// longer completes against the real file) fails a test instead of passing the
// smoke silently.
export const FAKE_ENV_TEMPLATE = [
  "COMPOSE_FILE=",
  "CIELE_IMAGE_TAG=",
  "PUBLIC_URL=",
  "SUPABASE_PUBLIC_URL=",
  "POSTGRES_PASSWORD=",
  "JWT_SECRET=",
  "ANON_KEY=",
  "SERVICE_ROLE_KEY=",
  "APP_ENCRYPTION_KEY=",
  "CRON_SECRET=",
  "OPENAI_COMPATIBLE_BASE_URL=",
  "OPENAI_COMPATIBLE_API_KEY=",
  "OPENAI_COMPATIBLE_CHAT_MODEL=",
  "OPENAI_COMPATIBLE_EMBEDDING_MODEL=",
].join("\n");
