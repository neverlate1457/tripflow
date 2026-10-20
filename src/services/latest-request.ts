/** Monotonic, in-memory guard for UI requests whose older responses must be ignored. */
export class LatestRequestGate {
  private sequence = 0;

  begin() {
    return ++this.sequence;
  }

  current() {
    return this.sequence;
  }

  isCurrent(request: number) {
    return request === this.sequence;
  }

  invalidate() {
    this.sequence += 1;
  }
}
