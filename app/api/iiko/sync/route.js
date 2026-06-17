import { NextResponse } from 'next/server';

export async function POST() {
  // This endpoint is intentionally a safe placeholder.
  // Direct iiko integration depends on the client's iiko type, API permissions, base URL, and report format.
  // Start with CSV/Excel export from iiko OLAP reports, then replace this endpoint with a real server-side connector.

  return NextResponse.json({
    ok: false,
    status: 'not_configured',
    message: 'iiko connector is not configured yet. Use manual CSV export first, then add confirmed iiko API credentials on the server side.'
  }, { status: 501 });
}
