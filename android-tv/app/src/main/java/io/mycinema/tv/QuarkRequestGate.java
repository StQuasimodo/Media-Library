package io.mycinema.tv;

import java.io.Closeable;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Single-account control API queue; media bytes never acquire this gate. */
final class QuarkRequestGate {
    static final int PLAYBACK=0, INTERACTIVE=1, BACKGROUND=2;
    interface Cancellation {void check() throws IOException;}
    private final List<Waiter> waiting=new ArrayList<>();
    private final long intervalNanos,timeoutNanos;
    private long nextStart;private boolean active;
    private static final class Waiter {final int priority;final long enqueued;Waiter(int p,long now){priority=p;enqueued=now;}}
    QuarkRequestGate(){this(200,30000);}
    QuarkRequestGate(long intervalMs,long timeoutMs){if(intervalMs<0||timeoutMs<=0)throw new IllegalArgumentException();intervalNanos=TimeUnit.MILLISECONDS.toNanos(intervalMs);timeoutNanos=TimeUnit.MILLISECONDS.toNanos(timeoutMs);nextStart=System.nanoTime();}
    private Waiter first(long now){
        Waiter first=null;int best=Integer.MAX_VALUE;
        for(Waiter w:waiting){
            // Age waiting work so continuous foreground traffic cannot starve it forever.
            int rank=Math.max(0,w.priority-(int)Math.min(2,(now-w.enqueued)/TimeUnit.SECONDS.toNanos(5)));
            if(first==null||rank<best){first=w;best=rank;}
        }
        return first;
    }
    Ticket acquire(int priority,Cancellation cancellation) throws IOException {
        if(priority<PLAYBACK||priority>BACKGROUND)throw new IllegalArgumentException("Invalid request priority");
        cancellation.check();long began=System.nanoTime();Waiter waiter=new Waiter(priority,began);
        synchronized(this){
            if(waiting.size()>=64)throw new IOException("夸克请求较多，请稍后重试。");
            waiting.add(waiter);
            try{
                while(true){
                    cancellation.check();long now=System.nanoTime();
                    if(now-began>=timeoutNanos)throw new IOException("等待夸克请求超时，请稍后重试。");
                    if(!active&&now-nextStart>=0&&first(now)==waiter){waiting.remove(waiter);active=true;nextStart=now+intervalNanos;return new Ticket();}
                    try{wait(50);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IOException("Request cancelled");}
                }
            }finally{waiting.remove(waiter);notifyAll();}
        }
    }
    synchronized void rateLimited(String retryAfter){
        long delay=5000;
        if(retryAfter!=null&&retryAfter.matches("[0-9]{1,6}"))delay=Math.min(30000,Math.max(1000,Long.parseLong(retryAfter)*1000));
        long until=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(delay);
        if(until-nextStart>0)nextStart=until;
        notifyAll();
    }
    final class Ticket implements Closeable {
        private boolean released;
        @Override public void close(){synchronized(QuarkRequestGate.this){if(released)return;released=true;active=false;QuarkRequestGate.this.notifyAll();}}
    }
    synchronized int queued(){return waiting.size();}
}
