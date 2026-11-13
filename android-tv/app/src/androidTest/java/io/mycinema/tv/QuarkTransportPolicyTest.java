package io.mycinema.tv;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Same production-policy checks run on a host JVM and in API22 instrumentation. */
public final class QuarkTransportPolicyTest {
    private static final QuarkRequestGate.Cancellation LIVE=()->{};
    private static void check(List<String> checks,boolean ok,String label){if(!ok)throw new AssertionError(label);checks.add(label);}
    private static void queued(QuarkRequestGate gate,int size) throws Exception {long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(gate.queued()!=size){if(System.nanoTime()>end)throw new AssertionError("queue did not reach "+size);Thread.sleep(5);}}
    public static List<String> run() throws Exception {
        List<String> checks=new ArrayList<>();long wall=1700000000000L,mono=1000000000L;
        LeaseLifetime known=LeaseLifetime.quark("1700000100",wall,mono);
        check(checks,!known.expired(mono+TimeUnit.SECONDS.toNanos(69)),"lease remains valid before expiry margin");
        check(checks,known.expired(mono+TimeUnit.SECONDS.toNanos(70)),"lease refreshes thirty seconds before known expiry");
        for(String unknown:new String[]{null,"", "garbage","99999999999999999999","1700000100000"}){
            LeaseLifetime fallback=LeaseLifetime.quark(unknown,wall,mono);
            check(checks,!fallback.expired(mono+TimeUnit.SECONDS.toNanos(119))&&fallback.expired(mono+TimeUnit.SECONDS.toNanos(120)),"unknown expiry uses bounded TTL: "+(unknown==null?"missing":unknown.length()));
        }
        check(checks,LeaseLifetime.quark("1699999999",wall,mono).expired(mono),"already expired upstream address is not retained");
        check(checks,LeaseLifetime.quark("1700000010",wall,mono).expired(mono),"near-expiry upstream address is not retained");
        check(checks,LeaseLifetime.quark("99999999999",wall,mono).expired(mono+TimeUnit.MINUTES.toNanos(10)),"distant server expiry is capped");
        check(checks,!known.expired(mono+TimeUnit.SECONDS.toNanos(10)),"reuse uses monotonic elapsed time without rereading wall clock");
        ExecutorService pool=Executors.newFixedThreadPool(3);
        try{
            QuarkRequestGate gate=new QuarkRequestGate(0,3000);List<Integer> order=Collections.synchronizedList(new ArrayList<>());
            QuarkRequestGate.Ticket active=gate.acquire(1,LIVE);
            Future<?> bg=pool.submit(()->{try(QuarkRequestGate.Ticket t=gate.acquire(2,LIVE)){order.add(2);}catch(IOException e){throw new RuntimeException(e);}});queued(gate,1);
            Future<?> ui=pool.submit(()->{try(QuarkRequestGate.Ticket t=gate.acquire(1,LIVE)){order.add(1);}catch(IOException e){throw new RuntimeException(e);}});queued(gate,2);
            Future<?> play=pool.submit(()->{try(QuarkRequestGate.Ticket t=gate.acquire(0,LIVE)){order.add(0);}catch(IOException e){throw new RuntimeException(e);}});queued(gate,3);active.close();active.close();
            play.get(3,TimeUnit.SECONDS);ui.get(3,TimeUnit.SECONDS);bg.get(3,TimeUnit.SECONDS);
            check(checks,order.equals(Arrays.asList(0,1,2)),"queued playback precedes browsing and scanning; release is idempotent");
            AtomicBoolean cancelled=new AtomicBoolean();active=gate.acquire(1,LIVE);
            Future<Boolean> pending=pool.submit(()->{try(QuarkRequestGate.Ticket t=gate.acquire(2,()->{if(cancelled.get())throw new IOException("cancelled");})){return false;}catch(IOException expected){return true;}});queued(gate,1);cancelled.set(true);
            check(checks,pending.get(2,TimeUnit.SECONDS)&&gate.queued()==0,"cancelled queued work leaves no network operation or queue entry");active.close();
            try(QuarkRequestGate.Ticket t=gate.acquire(0,LIVE)){check(checks,true,"queue remains usable after cancellation");}
            QuarkRequestGate cooldown=new QuarkRequestGate(0,80);cooldown.rateLimited("1");boolean timeout=false;
            try(QuarkRequestGate.Ticket t=cooldown.acquire(0,LIVE)){}catch(IOException expected){timeout=true;}
            check(checks,timeout&&cooldown.queued()==0,"rate-limit cooldown prevents immediate retry and wait is bounded");
            QuarkRequestGate pace=new QuarkRequestGate(60,3000);long before;
            try(QuarkRequestGate.Ticket t=pace.acquire(0,LIVE)){before=System.nanoTime();}
            try(QuarkRequestGate.Ticket t=pace.acquire(0,LIVE)){check(checks,System.nanoTime()-before>=TimeUnit.MILLISECONDS.toNanos(50),"control API starts are paced");}
            active=gate.acquire(1,LIVE);AtomicBoolean stop=new AtomicBoolean();
            // A holder is never preempted by priority work: only waiting requests are reordered.
            Future<Boolean> blocked=pool.submit(()->{try(QuarkRequestGate.Ticket t=gate.acquire(0,()->{if(stop.get())throw new IOException();})){return true;}catch(IOException e){return false;}});queued(gate,1);
            check(checks,!blocked.isDone(),"in-flight request retains exclusive permit");stop.set(true);blocked.get(2,TimeUnit.SECONDS);active.close();
        }finally{pool.shutdownNow();pool.awaitTermination(3,TimeUnit.SECONDS);}
        return checks;
    }
    public static void main(String[] args) throws Exception {List<String> checks=run();for(String check:checks)System.out.println("PASS "+check);System.out.println("Passed "+checks.size()+" transport policy checks");}
}
