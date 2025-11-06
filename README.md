# Off Peak Break Sales Assistant

A real-time AI sales coach that listens to your client calls and instantly provides compelling response suggestions to help you book more 15-minute discovery calls.

## Features

- **Real-Time Response Suggestions**: AI listens to client objections and instantly provides persuasive responses
- **Proven Sales Framework**: Uses social proof (Dell, IBM), data (Gallup research), and assumptive closing
- **Call Booking Focused**: Every suggestion guides the client toward scheduling a 15-minute call
- **Natural & Conversational**: Responses sound authentic, not robotic or salesy
- **Fortune 500 Credibility**: Built-in references to established OPB clients and research data

## Business Context

This assistant is specifically designed for Off Peak Break, a corporate travel and getaway service company focused on:
- Providing cost-effective off-peak travel experiences
- Enhancing employee work-life balance
- Offering customized corporate packages
- Delivering stress-free planning and booking services

## Setup

### Prerequisites

- Node.js 18+ installed
- A Deepgram API key ([Get one here](https://console.deepgram.com/))

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Edit `.env.local` and add your API key:
   ```
   NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_api_key_here
   ```

### Running the App

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Use

1. **Start Call**: Click the "Start Call" button to connect with the AI assistant
2. **Speak Naturally**: Have a conversation with the AI - it understands your sales context
3. **Get Real-Time Help**: The agent provides intelligent responses based on your business
4. **View Transcript**: See the conversation history in real-time
5. **End Call**: Click "End Call" when finished

## UI Components

### Live Transcript Panel (Left)
- Shows the current AI agent response in real-time
- Large, easy-to-read format for quick reference
- Updates as the agent speaks

### Conversation History Panel (Right)
- Complete conversation transcript
- Color-coded by speaker (Green for You, Blue for Assistant)
- Timestamped messages
- Auto-scrolls to latest message

## Agent Prompt

The AI assistant is powered by a comprehensive sales prompt that includes:

- Complete Off Peak Break business overview
- Key selling points and value propositions
- Common objections with proven responses
- Conversation analysis guidelines
- Response formatting rules

You can customize the agent prompt in `lib/agent-prompt.ts` to match your specific needs.

## Technology Stack

- **Frontend**: Next.js 15 with React 19
- **Styling**: Tailwind CSS
- **Voice Agent**: Deepgram Agent API (voice-to-voice)
- **AI Model**: GPT-4o via Deepgram
- **Animations**: Framer Motion
- **Language**: TypeScript

## How It Works

The application uses Deepgram's Agent API to create a voice-to-voice conversation:

1. **WebSocket Connection**: Connects directly to Deepgram's agent service using your API key
2. **Audio Streaming**: Streams microphone audio to Deepgram in real-time
3. **AI Processing**: Deepgram handles speech-to-text, AI processing (GPT-4o), and text-to-speech
4. **Response Playback**: Receives and plays audio responses from the agent

All processing happens in real-time with low latency.

## Customization

### Adjusting the AI Behavior

Edit `lib/agent-prompt.ts` to:
- Add more objection handling strategies
- Update company information
- Modify response tone and style
- Add industry-specific knowledge

### Styling

The app uses Tailwind CSS. Customize colors and styling in:
- `components/VoiceAgent.tsx` for component-specific styles
- `tailwind.config.ts` for global theme changes

## Troubleshooting

### Microphone Access
Make sure your browser has permission to access your microphone. The app will show an error if permissions are denied.

### API Key Issues
- Verify `NEXT_PUBLIC_DEEPGRAM_API_KEY` is correctly set in `.env.local`
- Ensure you have credits/quota available in your Deepgram account
- Check the browser console for specific error messages
- Make sure the API key starts with your Deepgram account's key format

### Voice Agent Not Working
- Check your internet connection (WebSocket requires stable connection)
- Verify the Deepgram API key is correct and active
- Ensure your microphone is working properly
- Try using headphones to prevent echo
- Check browser console for WebSocket connection errors

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
