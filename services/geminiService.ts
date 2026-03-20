import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generateCaption = async (topic: string, platform: string, tone: string = 'professional'): Promise<string> => {
  try {
    const model = 'gemini-2.5-flash';
    const prompt = `Write a ${tone} social media caption for ${platform} about: "${topic}". Include relevant hashtags. Keep it engaging and concise.`;
    
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    return response.text || "Could not generate caption.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating caption. Please check your API key.";
  }
};

export const generateReply = async (conversationHistory: string): Promise<string[]> => {
  try {
    const model = 'gemini-2.5-flash';
    const prompt = `You are a social media manager. Based on this conversation history, suggest 3 short, professional, and friendly quick replies for the last message.
    
    History:
    ${conversationHistory}
    
    Format output as a simple list of 3 strings separated by newlines. No numbering.`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const text = response.text || "";
    return text.split('\n').filter(line => line.trim().length > 0).slice(0, 3);
  } catch (error) {
    console.error("Gemini API Error:", error);
    return ["Thank you!", "We'll get back to you shortly.", "Could you provide more details?"];
  }
};