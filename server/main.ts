/**
 * Production entry point. Listens on PORT (8081 by default) and is reached only
 * through nginx's `/api/` proxy — it publishes no host port of its own, so the
 * Jira token is never exposed on an open port.
 */
import { createServer } from 'node:http';
import { ConfigError, readConfig } from './config';
import { createHandler } from './handler';

/**
 * Read independently of `readConfig`, which throws when Jira credentials are
 * missing. Binding the right port has to survive a bad configuration: the
 * container's whole job in that state is to *serve the error message*, and it
 * cannot do that from a port nginx is not proxying to.
 */
const port = Number(process.env.PORT ?? 8081);

try {
  const config = readConfig();
  console.log(
    `[constellation-api] source=${config.mode}` +
      (config.jira ? ` jira=${config.jira.baseUrl}` : ''),
  );
} catch (e) {
  // Print the actionable message, then keep serving: the handler returns the
  // same message over HTTP, which beats crash-looping with it buried in logs.
  console.error(`[constellation-api] ${e instanceof ConfigError ? e.message : String(e)}`);
}

const handler = createHandler();

createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return void res.end('ok\n');
  }
  handler(req, res);
}).listen(port, () => console.log(`[constellation-api] listening on :${port}`));
