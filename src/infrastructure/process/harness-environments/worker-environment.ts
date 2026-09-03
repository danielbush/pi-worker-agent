export function minimalWorkerEnvironment(source: NodeJS.ProcessEnv, temporaryDirectory: string, privateHome: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: source.PATH ?? "/usr/bin:/bin",
    TMPDIR: temporaryDirectory,
    HOME: privateHome,
  };
  for (const key of ["LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const) {
    if (source[key]) env[key] = source[key]!;
  }
  return env;
}
