import 'reflect-metadata';
import { AIService } from '../AIService';
import { circuitBreakerService as mockCircuitBreaker } from '../CircuitBreakerService';

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../lib/eventBus', () => ({
  eventBus: { emitJobProgress: jest.fn() },
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(),
    },
  })),
}));

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }),
    }),
  },
  SpanStatusCode: { OK: 0, ERROR: 1 },
}));

function makeAIService(): AIService {
  process.env.GEMINI_API_KEY = 'test-key';
  return new AIService(mockCircuitBreaker as any);
}

function cleanUp(): void {
  delete process.env.GEMINI_API_KEY;
}

describe('AIService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when model is initialized', () => {
      const s = makeAIService();
      expect(s.isAvailable()).toBe(true);
      cleanUp();
    });

    it('should return false when model is null', () => {
      const s = makeAIService();
      (s as any).model = null;
      (s as any).genAI = null;
      expect(s.isAvailable()).toBe(false);
      cleanUp();
    });

    it('should return false when GEMINI_API_KEY is not set', () => {
      const s = new AIService(mockCircuitBreaker as any);
      expect(s.isAvailable()).toBe(false);
    });
  });

  describe('generateContent', () => {
    it('should throw error when AI is not initialized', async () => {
      const s = makeAIService();
      (s as any).model = null;
      await expect(s.generateContent('test')).rejects.toThrow('Gemini AI not initialized');
      cleanUp();
    });

    it('should return generated text and token count on success', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: 'Hello from AI',
        usageMetadata: { totalTokenCount: 42 },
      });

      const result = await s.generateContent('Write a caption');

      expect(result).toEqual({ text: 'Hello from AI', totalTokens: 42 });
      cleanUp();
    });

    it('should throw circuit breaker fallback error on empty response', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: undefined,
        usageMetadata: {},
      });

      await expect(s.generateContent('test')).rejects.toThrow('AI service temporarily unavailable');
      cleanUp();
    });

    it('should use fallback response when circuit breaker fallback is triggered', async () => {
      const s = makeAIService();
      jest.spyOn(mockCircuitBreaker, 'execute').mockImplementation(
        async (_name: string, _fn: Function, fallback?: Function) => fallback!(),
      );

      const result = await s.generateContent('test', 'fallback text');
      expect(result).toEqual({ text: 'fallback text', totalTokens: 0 });
      cleanUp();
    });
  });

  describe('generateCaption', () => {
    it('should generate a caption with the correct prompt', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: 'Check out our new product! #instagram #launch',
        usageMetadata: { totalTokenCount: 10 },
      });

      const caption = await s.generateCaption('new product', 'instagram', 'professional');

      expect(caption).toBe('Check out our new product! #instagram #launch');
      cleanUp();
    });

    it('should use default tone when not provided', async () => {
      const s = makeAIService();
      const mockGenerateContent = jest.fn().mockResolvedValue({
        text: 'Exciting news!',
        usageMetadata: {},
      });
      (s as any).genAI.models.generateContent = mockGenerateContent;

      await s.generateCaption('test topic', 'twitter');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.stringContaining('professional'),
        }),
      );
      cleanUp();
    });
  });

  describe('generateReplies', () => {
    it('should return 3 reply suggestions from AI response', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: 'Thank you for your message!\nWe are looking into it.\nWill update you soon.',
        usageMetadata: { totalTokenCount: 15 },
      });

      const replies = await s.generateReplies('Conversation history');

      expect(replies).toHaveLength(3);
      expect(replies[0]).toBe('Thank you for your message!');
      cleanUp();
    });

    it('should return fallback replies when AI call fails', async () => {
      const s = makeAIService();
      jest.spyOn(mockCircuitBreaker, 'execute').mockRejectedValue(new Error('API error'));

      const replies = await s.generateReplies('Conversation history');

      expect(replies).toEqual([
        'Thank you for reaching out!',
        "We'll get back to you shortly.",
        'Could you provide more details?',
      ]);
      cleanUp();
    });

    it('should limit replies to maximum 3', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: 'One\nTwo\nThree\nFour\nFive',
        usageMetadata: {},
      });

      const replies = await s.generateReplies('Conversation');

      expect(replies).toHaveLength(3);
      cleanUp();
    });
  });

  describe('analyzeContent', () => {
    it('should return parsed sentiment, topics and keywords', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: JSON.stringify({
          sentiment: 'positive',
          topics: ['tech', 'AI'],
          keywords: ['innovation', 'future'],
        }),
        usageMetadata: { totalTokenCount: 20 },
      });

      const result = await s.analyzeContent('Amazing AI technology!');

      expect(result).toEqual({
        sentiment: 'positive',
        topics: ['tech', 'AI'],
        keywords: ['innovation', 'future'],
      });
      cleanUp();
    });

    it('should return fallback analysis when JSON parsing fails', async () => {
      const s = makeAIService();
      (s as any).genAI.models.generateContent = jest.fn().mockResolvedValue({
        text: 'not valid json',
        usageMetadata: {},
      });

      const result = await s.analyzeContent('Some content');

      expect(result).toEqual({
        sentiment: 'neutral',
        topics: ['general'],
        keywords: expect.any(Array),
      });
      cleanUp();
    });

    it('should return fallback analysis when AI call fails', async () => {
      const s = makeAIService();
      jest.spyOn(mockCircuitBreaker, 'execute').mockRejectedValue(new Error('API error'));

      const result = await s.analyzeContent('Some content');

      expect(result).toEqual({
        sentiment: 'neutral',
        topics: ['general'],
        keywords: expect.any(Array),
      });
      cleanUp();
    });
  });

  describe('getCircuitStatus', () => {
    it('should return circuit status from circuit breaker', () => {
      const s = makeAIService();
      jest.spyOn(mockCircuitBreaker, 'getStats').mockReturnValue({
        name: 'ai',
        state: 'closed',
      });

      const status = s.getCircuitStatus();

      expect(mockCircuitBreaker.getStats).toHaveBeenCalledWith('ai');
      cleanUp();
    });
  });
});
