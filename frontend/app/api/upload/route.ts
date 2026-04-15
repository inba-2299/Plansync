import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/upload — thin proxy to the Railway agent backend's /upload endpoint.
 *
 * Why proxy: the browser-to-backend file upload is same-origin (Vercel),
 * which avoids any CORS preflight on multipart bodies. Vercel's serverless
 * route just relays the body to Railway.
 *
 * The actual SheetJS parsing happens on Railway, not here.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const filename = req.nextUrl.searchParams.get('filename') ?? 'upload.csv';

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId query param required' }, { status: 400 });
  }

  // Forward the raw body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to read request body', detail: String(err) },
      { status: 400 }
    );
  }

  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'empty body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${AGENT_URL}/upload?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      }
    );

    const responseText = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(responseText);
    } catch {
      json = { error: 'backend returned non-JSON', body: responseText.slice(0, 500) };
    }

    return NextResponse.json(json, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to forward upload', detail: String(err) },
      { status: 502 }
    );
  }
}

// Allow large bodies (10 MB) — matches the Railway backend's express.raw limit
export const runtime = 'nodejs';
export const maxDuration = 30;
