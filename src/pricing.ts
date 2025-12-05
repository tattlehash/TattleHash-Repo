// TattleHash Pricing Configuration
// Use this file for all pricing-related UI and logic

export const PRICING = {
  // Base credit price
  CREDIT_PRICE_USD: 4.99,

  // Core attestation modes
  MODES: {
    solo: {
      name: 'Solo',
      credits: 1,
      price: 4.99,
      tagline: 'I have proof',
      description: 'Private blockchain-anchored proof',
      features: [
        'Blockchain anchoring',
        'Immutable proof',
        'Verification link',
        'QR code'
      ]
    },
    fire: {
      name: 'Fire',
      credits: 3,
      price: 14.97,
      tagline: 'Already sent it? Protect yourself now',
      description: 'Counterparty notification + PDF dossier',
      features: [
        'Everything in Solo',
        'Counterparty notification',
        'PDF dossier',
        'Court-ready evidence'
      ]
    },
    gatekeeper: {
      name: 'Gatekeeper',
      credits: 6,
      price: 29.94,
      tagline: 'Starting a deal? Lock them in first',
      description: 'Mutual co-signing + verification',
      features: [
        'Everything in Fire',
        'Mutual co-signing',
        'Configurable expiry',
        'Coin Toss fee split',
        'Auto-downgrade protection'
      ]
    },
    enforced: {
      name: 'Enforced',
      credits: 12,
      price: 59.88,
      tagline: 'Money locked until it\'s done',
      description: 'Co-signing + fund verification',
      features: [
        'Everything in Gatekeeper',
        'Real-time fund verification',
        'Balance proof (privacy-preserving)',
        'Traffic light risk assessment'
      ]
    }
  },

  // Credit packs
  PACKS: {
    starter: {
      name: 'Starter',
      credits: 10,
      price: 47.40,
      perCredit: 4.74,
      discount: 0.05,
      discountLabel: '5% off'
    },
    builder: {
      name: 'Builder',
      credits: 25,
      price: 116.00,
      perCredit: 4.64,
      discount: 0.07,
      discountLabel: '7% off'
    },
    professional: {
      name: 'Professional',
      credits: 50,
      price: 224.50,
      perCredit: 4.49,
      discount: 0.10,
      discountLabel: '10% off'
    },
    commercial: {
      name: 'Commercial',
      credits: 100,
      price: null, // Negotiated
      perCredit: null,
      discount: null,
      discountLabel: 'Contact us'
    }
  },

  // Add-ons
  ADDONS: {
    proofOfHuman: {
      name: 'Proof-of-Human',
      price: 0.49,
      description: 'Bot detection for Gatekeeper/Enforced'
    },
    proTier: {
      name: 'Pro Tier',
      price: 9.99,
      interval: 'month',
      description: 'Priority support, analytics dashboard'
    }
  },

  // Beta limits
  BETA_LIMITS: {
    maxEnforcedTransaction: 1000,    // USD
    maxCreditsPerPurchase: 25,
    maxAttestationsPerDay: 10
  },

  // Downgrade refunds (credits returned)
  DOWNGRADE_REFUNDS: {
    gatekeeperToFire: 3,  // 6 - 3 = 3 credits back
    enforcedToFire: 9     // 12 - 3 = 9 credits back
  },

  // Fee arrangements
  FEE_ARRANGEMENTS: {
    creatorPays: {
      name: 'Creator Pays',
      description: 'You pay the full fee'
    },
    split: {
      name: 'Split 50/50',
      description: 'Each party pays half'
    },
    coinToss: {
      name: 'Coin Toss',
      description: 'Blockchain randomness decides who pays'
    }
  }
} as const;

// Helper functions
export function calculatePackPrice(credits: number): number {
  if (credits >= 50) return credits * PRICING.CREDIT_PRICE_USD * 0.90;  // 10% off
  if (credits >= 25) return credits * PRICING.CREDIT_PRICE_USD * 0.93;  // 7% off
  if (credits >= 10) return credits * PRICING.CREDIT_PRICE_USD * 0.95;  // 5% off
  return credits * PRICING.CREDIT_PRICE_USD;  // full price
}

export function getModeByCredits(credits: number): keyof typeof PRICING.MODES | null {
  for (const [key, mode] of Object.entries(PRICING.MODES)) {
    if (mode.credits === credits) return key as keyof typeof PRICING.MODES;
  }
  return null;
}

export function formatPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatCredits(credits: number): string {
  return `${credits} credit${credits !== 1 ? 's' : ''}`;
}

// Mode comparison matrix
export const MODE_FEATURES = {
  'Blockchain anchoring': { solo: true, fire: true, gatekeeper: true, enforced: true },
  'Immutable proof': { solo: true, fire: true, gatekeeper: true, enforced: true },
  'Verification link': { solo: true, fire: true, gatekeeper: true, enforced: true },
  'Counterparty notification': { solo: false, fire: true, gatekeeper: true, enforced: true },
  'PDF dossier': { solo: false, fire: true, gatekeeper: true, enforced: true },
  'Mutual co-signing': { solo: false, fire: false, gatekeeper: true, enforced: true },
  'Configurable expiry': { solo: false, fire: false, gatekeeper: true, enforced: true },
  'Coin Toss fee split': { solo: false, fire: false, gatekeeper: true, enforced: true },
  'Auto-downgrade protection': { solo: false, fire: false, gatekeeper: true, enforced: true },
  'Fund verification': { solo: false, fire: false, gatekeeper: false, enforced: true },
  'Traffic light risk': { solo: false, fire: false, gatekeeper: false, enforced: true }
} as const;

// Use case recommendations
export const USE_CASE_RECOMMENDATIONS = {
  'I need proof for myself': 'solo',
  'I already sent payment': 'fire',
  'We\'re about to trade': 'gatekeeper',
  'High-value, need fund proof': 'enforced'
} as const;
