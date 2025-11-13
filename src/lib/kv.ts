export const JOB_TTL_SEC = 60 * 60 * 24;

export const qPref = (env: Env) => env.QUEUE_PREFIX || "anchor:jobs:";
export const rPref = (env: Env) => env.RECEIPT_PREFIX || "attest:";

export const jobKey = (env: Env, id: string) => `${qPref(env)}${id}`;
export const recKey = (env: Env, id: string) => `${rPref(env)}${id}`;
