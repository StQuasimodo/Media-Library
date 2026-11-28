package io.mycinema.tv;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Counters for one playback connection. No request identities, URLs or headers are retained. */
final class StreamMetrics {
    enum Step { ADDRESS, RESPONSE, READ, WRITE }
    private static final int RATE_SECONDS = 5;
    private final long[] rateSeconds = new long[RATE_SECONDS];
    private final long[] rateBytes = new long[RATE_SECONDS];
    private final long[] longest = new long[Step.values().length];
    private final List<Request> active = new ArrayList<>();
    private long received, forwarded, responses, retries;

    static final class Snapshot {
        final long received, forwarded, responses, retries, recentBytes;
        private final long[] waits, blocked;

        Snapshot(long received, long forwarded, long responses, long retries, long recentBytes,
                 long[] waits, long[] blocked) {
            this.received = received;
            this.forwarded = forwarded;
            this.responses = responses;
            this.retries = retries;
            this.recentBytes = recentBytes;
            this.waits = waits;
            this.blocked = blocked;
        }

        long maxMs(Step step) { return TimeUnit.NANOSECONDS.toMillis(waits[step.ordinal()]); }
        long currentMs(Step step) { return TimeUnit.NANOSECONDS.toMillis(blocked[step.ordinal()]); }
        double recentMbps() { return recentBytes * 8.0 / RATE_SECONDS / 1000000; }
    }

    final class Request implements AutoCloseable {
        private Step current;
        private long since;

        void begin(Step step) {
            synchronized (StreamMetrics.this) {
                current = step;
                since = System.nanoTime();
                if (step == Step.RESPONSE) responses++;
            }
        }

        void finish(int count) {
            synchronized (StreamMetrics.this) {
                if (current == null) return;
                long now = System.nanoTime();
                int index = current.ordinal();
                longest[index] = Math.max(longest[index], now - since);
                if (current == Step.READ) received += count;
                if (current == Step.WRITE && count > 0) {
                    forwarded += count;
                    long second = TimeUnit.NANOSECONDS.toSeconds(now);
                    int bucket = (int) ((second % RATE_SECONDS + RATE_SECONDS) % RATE_SECONDS);
                    if (rateSeconds[bucket] != second) {
                        rateSeconds[bucket] = second;
                        rateBytes[bucket] = 0;
                    }
                    rateBytes[bucket] += count;
                }
                current = null;
            }
        }

        void retry() { synchronized (StreamMetrics.this) { retries++; } }

        @Override public void close() {
            synchronized (StreamMetrics.this) {
                finish(0);
                active.remove(this);
            }
        }
    }

    synchronized Request open() {
        Request request = new Request();
        active.add(request);
        return request;
    }

    synchronized Snapshot snapshot() {
        long now = System.nanoTime();
        long[] waits = longest.clone();
        long[] blocked = new long[waits.length];
        for (Request request : active) {
            if (request.current == null) continue;
            int index = request.current.ordinal();
            blocked[index] = Math.max(blocked[index], now - request.since);
            waits[index] = Math.max(waits[index], blocked[index]);
        }
        long second = TimeUnit.NANOSECONDS.toSeconds(now);
        long recent = 0;
        for (int i = 0; i < RATE_SECONDS; i++) {
            long age = second - rateSeconds[i];
            if (age >= 0 && age < RATE_SECONDS) recent += rateBytes[i];
        }
        return new Snapshot(received, forwarded, responses, retries, recent, waits, blocked);
    }
}
