export type ActiveOperation = "analysis" | "wordbook-add" | "wordbook-check";

export interface ActiveRequest {
  attachedToView: boolean;
  nextSequence: number;
  operation: ActiveOperation;
}

export class ContentRequestLifetimes {
  private readonly requests = new Map<string, ActiveRequest>();

  begin(requestId: string, operation: ActiveOperation): void {
    this.requests.set(requestId, {
      attachedToView: true,
      nextSequence: 0,
      operation,
    });
  }

  get(requestId: string): ActiveRequest | undefined {
    return this.requests.get(requestId);
  }

  complete(requestId: string): ActiveRequest | undefined {
    const request = this.requests.get(requestId);
    if (request !== undefined) {
      this.requests.delete(requestId);
    }
    return request;
  }

  cancelOperation(operation: ActiveOperation): string[] {
    const requestIds: string[] = [];
    for (const [requestId, request] of this.requests) {
      if (request.operation === operation) {
        this.requests.delete(requestId);
        requestIds.push(requestId);
      }
    }
    return requestIds;
  }

  closeView(): string[] {
    const requestIds: string[] = [];
    for (const [requestId, request] of this.requests) {
      if (request.operation === "wordbook-add") {
        request.attachedToView = false;
      } else {
        this.requests.delete(requestId);
        requestIds.push(requestId);
      }
    }
    return requestIds;
  }

  cancelAll(): string[] {
    const requestIds = [...this.requests.keys()];
    this.requests.clear();
    return requestIds;
  }
}
