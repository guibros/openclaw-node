export interface TtsRequest {
  text: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  /** Natural language tone directive for Gemini TTS (e.g. "asmr whisper deep tone") */
  tone?: string;
}

export interface TtsResponse {
  audio: Buffer;
  contentType: string;
}

export interface TtsProvider {
  name: string;
  synthesize(req: TtsRequest): Promise<TtsResponse>;
}
