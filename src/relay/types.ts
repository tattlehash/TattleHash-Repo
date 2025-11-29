
export interface WebhookSubscription {
    id: string;
    user_id: string;
    url: string;
    events: string[]; // e.g., ['challenge.created', 'challenge.completed']
    secret: string; // For HMAC verification
    active: boolean;
    created_at: number;
}

export interface WebhookDelivery {
    id: string;
    subscription_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    status: 'PENDING' | 'DELIVERED' | 'FAILED';
    attempts: number;
    last_attempt_at?: number;
    delivered_at?: number;
    created_at: number;
}
