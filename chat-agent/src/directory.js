// Show-level destinations verified against the published podcast hub, 2026-09-19.
// Keep separate from episode transcripts and episode-specific catalog links.
export const SHOW_LINKS = Object.freeze([
  {title:'YouTube — Explore AI Out Loud',url:'https://www.youtube.com/@exploreAIoutloud',group:'platform'},
  {title:'Spotify — Explore AI Out Loud',url:'https://open.spotify.com/show/0348nx4ylmWesSj02ECRjY',group:'platform'},
  {title:'Apple Podcasts — Explore AI Out Loud',url:'https://podcasts.apple.com/us/podcast/explore-ai-out-loud/id6812370441',group:'platform'},
  {title:'Instagram — @exploreaioutloud',url:'https://www.instagram.com/exploreaioutloud/',group:'social'},
  {title:'TikTok — @exploreaioutloud',url:'https://www.tiktok.com/@exploreaioutloud',group:'social'},
  {title:'Explore AI Out Loud — podcast homepage',url:'https://www.mindovermoney.ai/podcast/',group:'home'},
]);

export function directoryAnswer(question,previousQuestion='') {
  const q=question.toLowerCase().replace(/[’]/g,"'");
  const named=/explore\s+ai\s+out\s+loud|\beaol\b/;
  const generic=/\b(?:the|your|our|this)\s+(?:podcast|show)\b|\bpodcast\s+links?\b/;
  const platform=/\b(?:youtube|spotify|apple podcasts?)\b/;
  const social=/\b(?:socials?|social media|instagram|insta|tiktok|tik tok)\b/;
  // Content questions must still retrieve evidence, even when they mention a platform.
  if(/\b(?:said|say|discuss|discussed|mention|mentioned|explain|summarize|transcript|build|built)\b/.test(q) || /\bepisode\s*\d+\b|\b(?:first|second|third) episode\b/.test(q))return null;
  if(/\b(?:newsletter|neural gains weekly|ngw)\b/.test(q) && !named.test(q) && !generic.test(q) && !social.test(q))return null;
  const followup=/^(?:and\s+|what about\s+)?(?:on\s+)?(?:youtube|spotify|apple podcasts?|instagram|insta|tiktok|tik tok)[\s?!.,]*$/.test(q.trim());
  const availability=/^(?:is|are|do you have)\b/.test(q) && (platform.test(q) || social.test(q));
  const bareListening=/^(?:where|how) can (?:i|we) (?:watch|listen)(?: to (?:it|you))?[\s?!.,]*$/.test(q.trim());
  const intent=/\b(?:where|link|links|access|find|follow|subscribe|watch|listen|available|platforms?|socials?|handles?|pages?)\b/.test(q);
  const priorScope=named.test(previousQuestion.toLowerCase()) || /\bpodcast\b/.test(previousQuestion.toLowerCase()) || social.test(previousQuestion.toLowerCase());
  const scoped=named.test(q) || generic.test(q) || social.test(q) || platform.test(q) && /\b(?:you|your|our|show|subscribe|link|links)\b/.test(q) || priorScope && /\b(?:it|that|there|you)\b/.test(q);
  if(!(intent && scoped || followup && priorScope || availability && scoped || bareListening || social.test(q) && /\b(?:your|our|follow|link)\b/.test(q)))return null;
  const socialOnly=social.test(q) && !platform.test(q) && !/\b(?:watch|listen|platforms?|podcast links?)\b/.test(q);
  const text=socialOnly
    ? 'Follow Explore AI Out Loud on Instagram and TikTok at @exploreaioutloud. Use the direct profile links below.'
    : 'Watch and subscribe to Explore AI Out Loud on YouTube, or listen and subscribe on Spotify and Apple Podcasts. Follow @exploreaioutloud on Instagram and TikTok. The direct links are below.';
  const links=SHOW_LINKS.filter(l=>!socialOnly || l.group==='social');
  return {text,sources:links.map(({title,url})=>({title,url,kind:'navigation'}))};
}
