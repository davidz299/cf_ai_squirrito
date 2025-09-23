export type Memory = {
  id: string;
  sessionId: string;
  locationText: string;
  lat: number;
  lng: number;
  joke: string;
  createdAt: number;
};

export type JokeRequest = {
  locationText: string;   // "Where are you roughly?"
  surroundings?: string;  // "What's around you?"
  todayPlan?: string;     // "What are you up to today?"
  lat?: number;
  lng?: number;
};
