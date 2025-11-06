import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Deepgram API key not configured' },
        { status: 500 }
      );
    }

    // Return the API key directly (for development)
    // In production, you might want to create a temporary key
    return NextResponse.json({ token: apiKey });
  } catch (error) {
    console.error('Error getting Deepgram token:', error);
    return NextResponse.json(
      { error: 'Failed to get token' },
      { status: 500 }
    );
  }
}
