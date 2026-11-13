package io.mycinema.tv;

/** Monotonic lease deadline. Only the Quark adapter interprets the known Expires field. */
final class LeaseLifetime {
    static final long FALLBACK_MS=120000, MAX_MS=600000, MARGIN_MS=30000;
    private final long startedNanos,validMillis;
    private LeaseLifetime(long startedNanos,long validMillis){this.startedNanos=startedNanos;this.validMillis=validMillis;}
    static LeaseLifetime quark(String expires,long wallMillis,long monotonicNanos){
        long valid=FALLBACK_MS;
        if(expires!=null&&expires.matches("[0-9]{1,11}"))try{
            long seconds=Long.parseLong(expires);
            long remaining=seconds*1000-wallMillis;
            valid=remaining<=MARGIN_MS?0:Math.min(MAX_MS,remaining-MARGIN_MS);
        }catch(NumberFormatException ignored){/* Unknown shape gets a bounded fallback. */}
        return new LeaseLifetime(monotonicNanos,valid);
    }
    boolean expired(long nowNanos){return nowNanos-startedNanos>=validMillis*1000000L;}
}
