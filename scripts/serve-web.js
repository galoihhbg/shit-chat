/**
 * Dead simple static server for `npm run web:build` output.
 *
 * Exists because `npx expo start` cannot run on machines where the inotify
 * instance limit is too low (EMFILE from Metro's file watcher). This path uses
 * no file watcher at all. No hot reload -- rerun `npm run web:preview` to pick
 * up changes. See the Troubleshooting section of the README.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(ROOT)) {
  console.error('No dist/ directory. Run `npm run web:build` first.');
  process.exit(1);
}

function handler(req, res) {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // Resolve inside ROOT only -- no climbing out with ../
  let filePath = path.join(ROOT, url);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('nope');
    return;
  }

  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const indexed = path.join(filePath, 'index.html');
      filePath = fs.existsSync(indexed) ? indexed : path.join(ROOT, 'index.html');
    }

    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    // A missing or unreadable file must not take the whole server down.
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

/**
 * Port 8080 is popular. Rather than dying with EADDRINUSE, walk up until we
 * find a free one and tell the user which we landed on.
 */
function listen(port, attemptsLeft) {
  const server = http.createServer(handler);

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Could not find a free port near ${PORT}.`);
      console.error('  Pick one yourself:  PORT=9000 npm run web:serve\n');
    } else {
      console.error(`\n  Server error: ${err.message}\n`);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`\n  ShitChat (static web build)  ->  http://localhost:${port}\n`);
    console.log('  Open it in two different browsers to test matchmaking.');
    console.log('  Rebuild after code changes:  npm run web:preview\n');
  });
}

listen(PORT, 12);
