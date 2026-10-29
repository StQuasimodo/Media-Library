package io.mycinema.tv;

import java.io.Closeable;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** One connection attempt or HTTP request owns its calls, including response-body reads. */
final class NetworkScope implements Closeable {
    private final Set<Call> calls=new HashSet<>();
    private boolean closed;

    synchronized void check() throws IOException {
        if(closed||Thread.currentThread().isInterrupted())throw new IOException("Request cancelled");
    }
    synchronized boolean cancelled(){return closed||Thread.currentThread().isInterrupted();}

    Exchange open(OkHttpClient client,Request request) throws IOException {
        Call call=client.newCall(request);
        synchronized(this){check();calls.add(call);}
        try{
            Response response=call.execute();
            synchronized(this){if(closed){response.close();throw new IOException("Request cancelled");}}
            return new Exchange(call,response);
        }catch(IOException|RuntimeException failure){synchronized(this){calls.remove(call);}call.cancel();throw failure;}
    }

    final class Exchange implements Closeable {
        final Response response;
        private final Call call;
        private boolean released;
        private Exchange(Call call,Response response){this.call=call;this.response=response;}
        @Override public void close(){
            synchronized(this){if(released)return;released=true;}
            // Cancel first: closing a discarded large response must not drain the movie.
            call.cancel();response.close();synchronized(NetworkScope.this){calls.remove(call);}
        }
    }

    @Override public synchronized void close(){
        if(closed)return;closed=true;for(Call call:calls)call.cancel();calls.clear();
    }
}
