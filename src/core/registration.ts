export type RegistrationState = 'UNREGISTERED' | 'REQUESTING' | 'REGISTERED' | 'REJECTED' | 'LOST';
export interface RegistrationEvent { node_id: number; state: RegistrationState | 'CREATED' | 'REMOVED'; sim_time_s: number; }
export interface NodeRegistration { state: RegistrationState; start_time_s: number | null; completion_time_s: number | null; }

/** Deterministic association abstraction. ACN acceptance is immediate; no RF/auth handshake is modeled. */
export class RegistrationLifecycle {
  private readonly states = new Map<number, NodeRegistration>();
  private readonly history: RegistrationEvent[] = [];
  constructor(private readonly historyLimit = 500) {}
  clear(): void { this.states.clear(); this.history.length = 0; }
  private record(nodeId: number, state: RegistrationEvent['state'], time: number): void {
    this.history.push({ node_id: nodeId, state, sim_time_s: time });
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
  }
  add(nodeId: number, time: number): void {
    this.record(nodeId, 'CREATED', time);
    this.states.set(nodeId, { state: 'UNREGISTERED', start_time_s: null, completion_time_s: null });
    this.record(nodeId, 'REQUESTING', time);
    this.states.set(nodeId, { state: 'REQUESTING', start_time_s: time, completion_time_s: null });
    this.record(nodeId, 'REGISTERED', time);
    this.states.set(nodeId, { state: 'REGISTERED', start_time_s: time, completion_time_s: time });
  }
  remove(nodeId: number, time: number): void { if (this.states.delete(nodeId)) this.record(nodeId, 'REMOVED', time); }
  get(nodeId: number): NodeRegistration { return this.states.get(nodeId) ?? { state: 'UNREGISTERED', start_time_s: null, completion_time_s: null }; }
  events(): RegistrationEvent[] { return this.history.map(event => ({ ...event })); }
  active(): Array<{ node_id: number; state: RegistrationState; start_time_s: number | null; completion_time_s: number | null }> {
    return [...this.states].map(([node_id, state]) => ({ node_id, ...state }));
  }
}
