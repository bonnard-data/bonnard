function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`ERROR: Required environment variable ${name} is not set.`);
    process.exit(1);
  }
  return val;
}

export const config = {
  /** Port for the Bonnard server. */
  port: parseInt(process.env.PORT ?? "3000", 10),

  /** Cube API base URL (e.g. http://cube:4000 or http://localhost:4000). */
  cubeApiUrl: required("CUBE_API_URL").replace(/\/+$/, ""),

  /** Optional HS256 secret for signing Cube JWTs. If not set, requests are unauthenticated. */
  cubeApiSecret: process.env.CUBE_API_SECRET || undefined,

  /** Optional bearer token to protect all non-health endpoints. */
  adminToken: process.env.ADMIN_TOKEN || undefined,

  /** CORS allowed origin (* = any, or a specific URL). */
  corsOrigin: process.env.CORS_ORIGIN || "*",

  /** Directory where deployed model files are written. */
  modelDir: process.env.MODEL_DIR || "/app/models",
};
