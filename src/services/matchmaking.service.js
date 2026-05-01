const { query } = require('../db');
const { calculateAge } = require('../utils/helpers');

/**
 * Common Compatibility Score Calculator (Layer 2)
 * Compares two profiles and returns a score 0-100%
 */
const calculateCompatibility = (me, myPrefs, them, theirFamily) => {
  let score = 0;
  let totalWeight = 0;

  // 1. Faith & Denomination (30%)
  totalWeight += 30;
  if (me.denomination === them.denomination) score += 20;
  else if (myPrefs?.preferred_denominations?.includes(them.denomination)) score += 15;
  else if (myPrefs?.denomination_flexible) score += 10;
  
  if (me.faith_level === them.faith_level) score += 10;
  else if (me.faith_level && them.faith_level) score += 5; // Has some faith info

  // 2. Lifestyle (20%)
  totalWeight += 20;
  if (me.smoking === them.smoking) score += 7;
  if (me.drinking === them.drinking) score += 7;
  if (me.diet === them.diet) score += 6;

  // 3. Marriage Intent & Timeline (20%)
  totalWeight += 20;
  if (me.marriage_intent === them.marriage_intent) score += 10;
  else if (me.marriage_intent && them.marriage_intent) score += 5;

  if (me.marriage_timeline === them.marriage_timeline) score += 10;
  else if (me.marriage_timeline && them.marriage_timeline) score += 5;

  // 4. Career & Education (15%)
  totalWeight += 15;
  if (myPrefs?.education_preference === them.education) score += 8;
  else if (myPrefs?.education_preference?.length === 0) score += 8;

  if (them.annual_income_max >= (myPrefs?.salary_min || 0)) score += 7;

  // 5. Family Background (15%)
  totalWeight += 15;
  // Approximation - just boost if they provided family info matching yours roughly (e.g. class)
  if (theirFamily && theirFamily.family_class) {
     score += 15; // Placeholder: Just reward having family details
  }

  // Normalize returning 0-100
  return Math.round((score / totalWeight) * 100);
};

module.exports = { calculateCompatibility };
