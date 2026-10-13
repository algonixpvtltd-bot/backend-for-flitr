import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchYouTube } from './youtube-search.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

if (fs.existsSync(path.join(root, '.env'))) {
  process.loadEnvFile(path.join(root, '.env'));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    // YouTube search API endpoint
    if (url.pathname === '/api/youtube/search' && req.method === 'GET') {
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/json',
      });
      return res.end(
        JSON.stringify(
          await searchYouTube((url.searchParams.get('q') || '').slice(0, 100))
        )
      );
    }

    if (url.pathname.startsWith('/api/')) {
      res.writeHead(410, {
        ...corsHeaders,
        'Content-Type': 'application/json',
      });
      return res.end(
        JSON.stringify({ error: 'Room data has moved to Firebase.' })
      );
    }

    const base = path.join(root, 'dist');
    const requested = path.resolve(
      base,
      '.' + decodeURIComponent(url.pathname)
    );
    const file =
      requested.startsWith(base + path.sep) &&
      fs.existsSync(requested) &&
      fs.statSync(requested).isFile()
        ? requested
        : path.join(base, 'index.html');

    // If dist/ folder doesn't exist (e.g. backend-only deployment)
    if (!fs.existsSync(file)) {
      if (url.pathname === '/' || url.pathname === '/health') {
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'application/json',
        });
        return res.end(
          JSON.stringify({
            status: 'ok',
            service: 'Velune media backend',
            endpoints: {
              search: '/api/youtube/search?q={query}',
            },
          })
        );
      }
      res.writeHead(404, {
        ...corsHeaders,
        'Content-Type': 'application/json',
      });
      return res.end(
        JSON.stringify({
          error: 'Not found. Frontend static build is not hosted here.',
        })
      );
    }

    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };

    const size = fs.statSync(file).size;
    const headers = {
      ...corsHeaders,
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };

    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416);
        return res.end();
      }
      const start = Number(match[1]);
      const end = Math.min(
        match[2] ? Number(match[2]) : size - 1,
        size - 1
      );
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    }
  } catch {
    res.writeHead(400);
    res.end('Invalid request');
  }
});

server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () =>
  console.log(
    'Velune media server: http://localhost:3001 (rooms use Firebase)'
  )
);
