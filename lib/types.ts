export interface Message {
  id: string;
  speaker: 'sales-rep' | 'client';
  text: string;
  timestamp: Date;
}

export interface SuggestedResponse {
  analysis: string;
  suggestedResponse: string;
  confidence: number;
  alternativeAngle?: string;
  keyPoints: string[];
  nextStep: string;
}

export interface ConversationState {
  messages: Message[];
  currentSuggestion: SuggestedResponse | null;
  isListening: boolean;
  isProcessing: boolean;
}
