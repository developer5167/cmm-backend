const axios = require('axios');

/**
 * AI Service for GraceMatch
 * Provides placeholders for LLM integration (Gemini / OpenAI)
 */

const getGeminiResponse = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }]
    });
    return response.data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('Gemini API Error:', err?.response?.data || err.message);
    return null;
  }
};

/**
 * Generate a smart Match Explanation based on two user profiles
 */
const generateMatchExplanation = async (user1Profile, user2Profile) => {
  const prompt = `
    You are a Christian Matchmaking assistant. Explain why User A and User B might be a good match in 2 short sentences.
    User A: ${user1Profile.first_name}, ${user1Profile.age} yrs old, ${user1Profile.profession}, ${user1Profile.denomination}.
    User B: ${user2Profile.first_name}, ${user2Profile.age} yrs old, ${user2Profile.profession}, ${user2Profile.denomination}.
  `;

  const aiText = await getGeminiResponse(prompt);
  
  if (aiText) {
    return aiText.trim();
  }

  // Fallback if no API key
  let fallback = `${user1Profile.first_name} and ${user2Profile.first_name} share common ground in their faith`;
  if (user1Profile.denomination === user2Profile.denomination) {
    fallback += ` as they are both ${user1Profile.denomination}.`;
  } else {
    fallback += `.`;
  }
  return fallback;
};

/**
 * Summarize profile
 */
const generateProfileSummary = async (profile) => {
  const prompt = `Write a welcoming 2-sentence bio for a Christian matrimony profile. 
  Name: ${profile.first_name}, Profession: ${profile.profession}, Denomination: ${profile.denomination}. 
  Focus on faith and their career.`;
  
  const aiText = await getGeminiResponse(prompt);
  if (aiText) return aiText.trim();
  
  return `Hi, I'm ${profile.first_name}. I work as a ${profile.profession} and my faith as a ${profile.denomination} is central to my life. I'm looking for a partner to build a Christ-centered home.`;
};

/**
 * AI Content Moderation
 */
const moderateContent = async (text) => {
  const prompt = `Analyze this text for inappropriate content, profanity, or spam. Reply ONLY with "SAFE" or "UNSAFE". Text: "${text}"`;
  const aiText = await getGeminiResponse(prompt);
  
  if (aiText) {
    return aiText.trim().toUpperCase().includes('SAFE');
  }

  // Fallback simple regex
  const blocklist = ['spam', 'abuse', 'buy this', 'crypto'];
  const unsafe = blocklist.some(w => text.toLowerCase().includes(w));
  return !unsafe;
};

module.exports = {
  generateMatchExplanation,
  generateProfileSummary,
  moderateContent,
};
