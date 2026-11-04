/** The network hop between the terminal and the venue. Resolves when the venue acknowledges receipt. */
export interface Gateway {
  send(orderId: string): Promise<void>;
}

export interface SimulatedGateway extends Gateway {
  /** Probability (0..1) that a send times out without acknowledgement. */
  failureRate: number;
}

export function createSimulatedGateway(
  opts: { minMs?: number; maxMs?: number; failureRate?: number; random?: () => number } = {},
): SimulatedGateway {
  const minMs = opts.minMs ?? 120;
  const maxMs = opts.maxMs ?? 380;
  const random = opts.random ?? Math.random;
  const gateway: SimulatedGateway = {
    failureRate: opts.failureRate ?? 0,
    send(_orderId) {
      const delay = minMs + random() * (maxMs - minMs);
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (random() < gateway.failureRate) reject(new Error('Network timeout — order not acknowledged'));
          else resolve();
        }, delay);
      });
    },
  };
  return gateway;
}
