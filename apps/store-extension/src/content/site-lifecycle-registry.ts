import {
  STORE_MESSAGE_VERSION,
  parseStoreSitePolicyResponse,
  type StoreSitePolicyRequest,
  type StoreSitePolicyResponse,
} from "@huayi/store-domain";

export interface StoreSiteParticipant {
  start(): Promise<void> | void;
  stop(): void;
  update?(policy: StoreSitePolicyResponse): void;
}

interface ParticipantState {
  active: boolean;
  readonly participant: StoreSiteParticipant;
}

type SiteMessageSender = (message: StoreSitePolicyRequest) => Promise<unknown>;

export class StoreSiteLifecycle {
  private enabled = false;
  private readonly participants = new Map<string, ParticipantState>();
  private policy: StoreSitePolicyResponse | null = null;

  constructor(private readonly sendMessage: SiteMessageSender) {}

  register(key: string, participant: StoreSiteParticipant): () => void {
    this.unregister(key);
    const state = { active: false, participant };
    this.participants.set(key, state);
    if (this.policy !== null) participant.update?.(this.policy);
    if (this.enabled) this.start(state);
    return () => {
      if (this.participants.get(key) !== state) return;
      this.stop(state);
      this.participants.delete(key);
    };
  }

  async refresh(): Promise<StoreSitePolicyResponse> {
    try {
      const response = parseStoreSitePolicyResponse(
        await this.sendMessage({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/site-policy",
        }),
      );
      this.apply(response);
      return response;
    } catch (error) {
      this.disable();
      throw error;
    }
  }

  async toggle(enabled: boolean): Promise<StoreSitePolicyResponse> {
    if (!enabled) this.disable();
    try {
      const response = parseStoreSitePolicyResponse(
        await this.sendMessage({
          enabled,
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/site-toggle",
        }),
      );
      this.apply(response);
      return response;
    } catch (error) {
      this.disable();
      throw error;
    }
  }

  currentPolicy(): StoreSitePolicyResponse | null {
    return this.policy;
  }

  private apply(policy: StoreSitePolicyResponse): void {
    this.policy = policy;
    this.enabled = policy.enabled;
    for (const state of this.participants.values()) {
      state.participant.update?.(policy);
      if (this.enabled) this.start(state);
      else this.stop(state);
    }
  }

  private disable(): void {
    this.policy = null;
    this.enabled = false;
    for (const state of this.participants.values()) this.stop(state);
  }

  private start(state: ParticipantState): void {
    if (state.active) return;
    state.active = true;
    try {
      void Promise.resolve(state.participant.start()).catch(() => {
        state.active = false;
      });
    } catch {
      state.active = false;
    }
  }

  private stop(state: ParticipantState): void {
    if (!state.active) return;
    state.active = false;
    state.participant.stop();
  }

  private unregister(key: string): void {
    const existing = this.participants.get(key);
    if (existing === undefined) return;
    this.stop(existing);
    this.participants.delete(key);
  }
}

interface LifecycleRegistryEntry {
  readonly lifecycle: StoreSiteLifecycle;
}

const SITE_LIFECYCLE_KEY = Symbol.for("@huayi/store-extension/site-lifecycle");

export function getOrCreateStoreSiteLifecycle(sendMessage: SiteMessageSender): StoreSiteLifecycle {
  const existing = Reflect.get(globalThis, SITE_LIFECYCLE_KEY) as
    LifecycleRegistryEntry | undefined;
  if (existing !== undefined) return existing.lifecycle;
  const lifecycle = new StoreSiteLifecycle(sendMessage);
  Reflect.set(globalThis, SITE_LIFECYCLE_KEY, { lifecycle });
  return lifecycle;
}
