'use server';
import { conversationalBallie, type ConversationalBallieInput, type ConversationalBallieOutput } from '@/ai/flows/conversational-ballie';

// The function now accepts the AI flow's input type directly,
// ensuring only serializable data is passed from the client.
export async function askBallie(input: ConversationalBallieInput): Promise<ConversationalBallieOutput> {
  try {
    // The input is already in the correct shape for the AI flow.
    const response = await conversationalBallie(input);
    return response;
  } catch (error) {
    console.error('Error calling Ballie AI:', error);
    // Return a valid object that matches the output schema for a non-clinical response.
    // The 'recommendation' and 'confidence' fields are optional and should be omitted on error.
    return {
      explanation: 'Sorry, I was unable to process your request. Please check the system logs.',
    };
  }
}
