/* Release gate: keep false until the checklist in AURA_SPONSORSHIP.md passes.
   No URL/localStorage override is accepted in production. */
window.AURA_CONFIG = Object.freeze({
  enabled: false,
  ownerUid: '',
  rulesVerified: false,
  currency: 'INR',
  timeZone: 'Asia/Kolkata'
});
