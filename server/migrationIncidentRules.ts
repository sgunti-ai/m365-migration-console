export function isThrottlingIncident(type: string, payload: unknown) {
  return /throttl|429|503|rate\.limit/i.test(`${type} ${JSON.stringify(payload)}`);
}
